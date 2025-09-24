function randomString(size) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < size; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
const sqlite3 = require("better-sqlite3");
module.exports = class{
    init(){
        this.db.exec(`
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS short_urls (
                id TEXT PRIMARY KEY,
                short TEXT UNIQUE NOT NULL,
                url TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                warning BOOLEAN NOT NULL DEFAULT false,
                username TEXT NOT NULL DEFAULT "no-name"
            );
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS clicks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                short_url_id TEXT NOT NULL,
                hashed_ip TEXT NOT NULL,
                browser TEXT DEFAULT "unknown",
                referrer TEXT DEFAULT "Direct",
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (short_url_id) REFERENCES short_urls (id)
            );
        `);
        
        // Migration: Fix any existing records with NULL ids
        const nullIdRecords = this.db.prepare(`SELECT short FROM short_urls WHERE id IS NULL`).all();
        if (nullIdRecords.length > 0) {
            console.log(`Fixing ${nullIdRecords.length} records with NULL ids...`);
            for (const record of nullIdRecords) {
                const newId = randomString(64);
                this.db.prepare(`UPDATE short_urls SET id = ? WHERE short = ?`).run(newId, record.short);
            }
            console.log('✓ Migration complete: Fixed NULL id records');
            // Clear cache so updated records get loaded fresh
            this.shortens = {};
            this.ns = [];
        }
    }
    constructor(path){
        this.db = sqlite3(path);
        this.init();
        this.shortens = {};
        this.ns = []; // the exact opposite as of above :hs:
    }
    getShort(short){
        if (!this.shortens[short] && !this.ns[short]){
            let url = this.db.prepare(`SELECT * FROM short_urls WHERE short = ?`).get(short);
            if (!url){
                this.ns.push(short);
                return false;
            }
            this.shortens[url.short]=url
        }
        if (this.ns[short]) return false;
        return this.shortens[short]
    }
    addShort(slug,url,username,warning){
        const id = randomString(64);
        const result = this.db.prepare(`INSERT INTO short_urls (id, short,url,warning,username) VALUES (?,?,?,?,?)`).run(id,slug,url,warning ? 1 : 0,username);
        
        // Add to cache
        this.shortens[slug] = {
            id: id,  // Use the actual id we inserted, not lastInsertRowid
            short: slug,
            url: url,
            warning: warning,
            username: username,
            created_at: new Date().toISOString()
        };
        
        // Remove from "not found" cache if it was there
        const nsIndex = this.ns.indexOf(slug);
        if (nsIndex > -1) {
            this.ns.splice(nsIndex, 1);
        }
    }
    removeShort(id){
        // First get the short URL to remove from cache
        const record = this.db.prepare(`SELECT short FROM short_urls WHERE id = ?`).get(id);
        
        // Delete related clicks first to avoid foreign key constraint
        this.db.prepare(`DELETE FROM clicks WHERE short_url_id = ?`).run(id);
        
        // Then delete the short URL
        this.db.prepare(`DELETE FROM short_urls WHERE id = ?`).run(id);
        
        // Clear from cache
        if (record && record.short) {
            delete this.shortens[record.short];
            const nsIndex = this.ns.indexOf(record.short);
            if (nsIndex > -1) {
                this.ns.splice(nsIndex, 1);
            }
        }
    }
    modifyShort(id,slug,url,username,warning){
        // First get the old short URL to remove from cache
        const oldRecord = this.db.prepare(`SELECT short FROM short_urls WHERE id = ?`).get(id);
        this.db.prepare(`UPDATE short_urls SET short = ?, url = ?, username = ?, warning = ? WHERE id = ?`).run(slug,url,username,warning,id);
        
        // Clear old cache entries
        if (oldRecord && oldRecord.short) {
            delete this.shortens[oldRecord.short];
            const nsIndex = this.ns.indexOf(oldRecord.short);
            if (nsIndex > -1) {
                this.ns.splice(nsIndex, 1);
            }
        }
    }
    getShortsByUsername(username){
        return this.db.prepare(`SELECT * FROM short_urls WHERE username = ?`).all(username)
    }
    getShortsById(ID){
        return this.db.prepare(`SELECT * FROM short_urls WHERE id = ?`).all(ID)
    }
    
    // Statistics functions - using the new clicks table
    getTotalClicksForShort(shortId) {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM clicks 
                WHERE short_url_id = ?
            `).get(shortId);
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting clicks for short:', error);
            return 0;
        }
    }
    
    getClicksForShortByDateRange(shortId, days = 7) {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM clicks 
                WHERE short_url_id = ? AND created_at >= datetime('now', '-${days} days')
            `).get(shortId);
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting clicks by date range:', error);
            return 0;
        }
    }
    
    getClicksForShortToday(shortId) {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM clicks 
                WHERE short_url_id = ? AND date(created_at) = date('now')
            `).get(shortId);
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting clicks for today:', error);
            return 0;
        }
    }
    
    getTopReferrersForShort(shortId, limit = 5) {
        try {
            const results = this.db.prepare(`
                SELECT referrer as refer_link, COUNT(*) as count
                FROM clicks 
                WHERE short_url_id = ?
                GROUP BY referrer
                ORDER BY count DESC
                LIMIT ?
            `).all(shortId, limit);
            return results || [];
        } catch (error) {
            console.log('Error getting top referrers:', error);
            return [];
        }
    }
    
    getBrowserStatsForShort(shortId) {
        try {
            const results = this.db.prepare(`
                SELECT browser, COUNT(*) as count
                FROM clicks 
                WHERE short_url_id = ?
                GROUP BY browser
                ORDER BY count DESC
            `).all(shortId);
            
            if (!results || results.length === 0) {
                return [];
            }
            
            const total = results.reduce((sum, browser) => sum + browser.count, 0);
            return results.map(browser => ({
                name: browser.browser === 'unknown' ? 'Unknown' : browser.browser,
                count: browser.count,
                percentage: Math.round((browser.count / total) * 100)
            }));
        } catch (error) {
            console.log('Error getting browser stats:', error);
            return [];
        }
    }
    
    getClickHistoryForShort(shortId, days = 7) {
        try {
            const results = this.db.prepare(`
                SELECT date(created_at) as day, COUNT(*) as clicks
                FROM clicks 
                WHERE short_url_id = ? AND created_at >= datetime('now', '-${days} days')
                GROUP BY date(created_at)
                ORDER BY day ASC
            `).all(shortId);
            return results || [];
        } catch (error) {
            console.log('Error getting click history:', error);
            return [];
        }
    }
    
    // Global statistics
    getTotalLinksCount() {
        const result = this.db.prepare(`SELECT COUNT(*) as count FROM short_urls`).get();
        return result ? result.count : 0;
    }
    
    getTotalClicksCount() {
        const result = this.db.prepare(`SELECT COUNT(*) as count FROM clicks`).get();
        return result ? result.count : 0;
    }
    
    getLinksCreatedToday() {
        const result = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM short_urls 
            WHERE date(created_at) = date('now')
        `).get();
        return result ? result.count : 0;
    }
    
    getMostPopularLink() {
        const result = this.db.prepare(`
            SELECT su.short, COUNT(c.id) as clicks 
            FROM short_urls su 
            LEFT JOIN clicks c ON su.id = c.short_url_id 
            GROUP BY su.id 
            ORDER BY clicks DESC 
            LIMIT 1
        `).get();
        return result ? result.short : null;
    }
    
    recordClick(shortId, hashedIp, browser = 'unknown', referrer = 'unknown') {
        try {
            // Verify the shortId exists and is not null
            if (!shortId) {
                console.error('shortId is null or undefined!');
                return;
            }
            
            // Insert the click record into the simplified clicks table
            this.db.prepare(`
                INSERT INTO clicks (short_url_id, hashed_ip, browser, referrer) 
                VALUES (?, ?, ?, ?)
            `).run(shortId, hashedIp, browser, referrer);
        } catch (error) {
            console.error('Error recording click:', error);
            // Don't throw - we don't want click tracking to break the redirect
        }
    }
    
    // Additional dashboard functions
    getRecentLinks(limit = 10) {
        return this.db.prepare(`
            SELECT short, url, created_at, warning, username 
            FROM short_urls 
            ORDER BY created_at DESC 
            LIMIT ?
        `).all(limit);
    }
    
    getTopLinks(limit = 5) {
        // Mock data for now - in real implementation, this would join with click data
        const allLinks = this.db.prepare(`SELECT short, url FROM short_urls ORDER BY RANDOM() LIMIT ?`).all(limit);
        return allLinks.map(link => ({
            ...link,
            clicks: Math.floor(Math.random() * 100) + 10 // Mock click count
        }));
    }
    
    getGlobalBrowserStats() {
        // Mock data for now - in real implementation, this would aggregate from ss_click
        return [
            { browser: 'Chrome', count: 156, percentage: 62 },
            { browser: 'Firefox', count: 48, percentage: 19 },
            { browser: 'Safari', count: 32, percentage: 13 },
            { browser: 'Edge', count: 15, percentage: 6 }
        ];
    }
    
    getGlobalReferrerStats(limit = 10) {
        // Mock data for now - in real implementation, this would aggregate from ss_click
        const mockReferrers = [
            { refer_link: 'Direct', count: 89 },
            { refer_link: 'google.com', count: 56 },
            { refer_link: 'twitter.com', count: 34 },
            { refer_link: 'facebook.com', count: 28 },
            { refer_link: 'reddit.com', count: 19 },
            { refer_link: 'github.com', count: 12 },
            { refer_link: 'linkedin.com', count: 8 }
        ];
        return mockReferrers.slice(0, limit);
    }
    
    getClickTrends(days = 7) {
        // Mock data for now - in real implementation, this would aggregate clicks by day
        const trends = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            trends.push({
                date: date.toISOString().split('T')[0],
                day: date.toLocaleDateString('en-US', { weekday: 'short' }),
                clicks: Math.floor(Math.random() * 50) + 10
            });
        }
        return trends;
    }
    
    // User-specific statistics functions
    getUserTotalClicks(username) {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM clicks c 
                INNER JOIN short_urls su ON c.short_url_id = su.id
                WHERE su.username = ?
            `).get(username);
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting user total clicks:', error);
            return 0;
        }
    }
    
    getUserLinksCreatedToday(username) {
        const result = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM short_urls 
            WHERE username = ? AND date(created_at) = date('now')
        `).get(username);
        return result ? result.count : 0;
    }
    
    getUserMostPopularLink(username) {
        try {
            const result = this.db.prepare(`
                SELECT su.short, COUNT(c.id) as clicks 
                FROM short_urls su 
                LEFT JOIN clicks c ON su.id = c.short_url_id 
                WHERE su.username = ?
                GROUP BY su.id 
                ORDER BY clicks DESC 
                LIMIT 1
            `).get(username);
            return result ? result.short : null;
        } catch (error) {
            console.log('Error getting user most popular link:', error);
            return null;
        }
    }
    
    getUserRecentLinks(username, limit = 10) {
        return this.db.prepare(`
            SELECT short, url, created_at, warning, username 
            FROM short_urls 
            WHERE username = ?
            ORDER BY created_at DESC 
            LIMIT ?
        `).all(username, limit);
    }
    
    getUserTopLinks(username, limit = 5) {
        try {
            const results = this.db.prepare(`
                SELECT su.short, su.url, COUNT(c.id) as clicks
                FROM short_urls su 
                LEFT JOIN clicks c ON su.id = c.short_url_id 
                WHERE su.username = ?
                GROUP BY su.id 
                ORDER BY clicks DESC 
                LIMIT ?
            `).all(username, limit);
            return results || [];
        } catch (error) {
            console.log('Error getting user top links:', error);
            // Fallback to just getting user's links without click data
            const userLinks = this.db.prepare(`
                SELECT short, url 
                FROM short_urls 
                WHERE username = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `).all(username, limit);
            return userLinks.map(link => ({ ...link, clicks: 0 }));
        }
    }
    
    getUserBrowserStats(username) {
        try {
            const results = this.db.prepare(`
                SELECT c.browser, COUNT(*) as count
                FROM clicks c 
                INNER JOIN short_urls su ON c.short_url_id = su.id
                WHERE su.username = ?
                GROUP BY c.browser
                ORDER BY count DESC
            `).all(username);
            
            if (!results || results.length === 0) {
                return [];
            }
            
            const total = results.reduce((sum, browser) => sum + browser.count, 0);
            return results.map(browser => ({
                browser: browser.browser === 'unknown' ? 'Unknown' : browser.browser,
                count: browser.count,
                percentage: Math.round((browser.count / total) * 100)
            }));
        } catch (error) {
            console.log('Error getting user browser stats:', error);
            return [];
        }
    }
    
    getUserReferrerStats(username, limit = 10) {
        try {
            const results = this.db.prepare(`
                SELECT c.referrer as refer_link, COUNT(*) as count
                FROM clicks c 
                INNER JOIN short_urls su ON c.short_url_id = su.id
                WHERE su.username = ?
                GROUP BY c.referrer
                ORDER BY count DESC
                LIMIT ?
            `).all(username, limit);
            return results || [];
        } catch (error) {
            console.log('Error getting user referrer stats:', error);
            return [];
        }
    }
    
    getUserClickTrends(username, days = 7) {
        try {
            const results = this.db.prepare(`
                SELECT date(c.created_at) as date, COUNT(*) as clicks
                FROM clicks c 
                INNER JOIN short_urls su ON c.short_url_id = su.id
                WHERE su.username = ? AND c.created_at >= datetime('now', '-${days} days')
                GROUP BY date(c.created_at)
                ORDER BY date ASC
            `).all(username);
            
            // Fill in missing days with 0 clicks
            const trends = [];
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                const found = results.find(r => r.date === dateStr);
                trends.push({
                    date: dateStr,
                    day: date.toLocaleDateString('en-US', { weekday: 'short' }),
                    clicks: found ? found.clicks : 0
                });
            }
            return trends;
        } catch (error) {
            console.log('Error getting user click trends:', error);
            // Return empty trends
            const trends = [];
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                trends.push({
                    date: date.toISOString().split('T')[0],
                    day: date.toLocaleDateString('en-US', { weekday: 'short' }),
                    clicks: 0
                });
            }
            return trends;
        }
    }

    // Admin-specific methods
    getAllUsers() {
        try {
            const result = this.db.prepare(`
                SELECT DISTINCT username 
                FROM short_urls 
                ORDER BY username
            `).all();
            return result.map(row => row.username);
        } catch (error) {
            console.log('Error getting all users:', error);
            return [];
        }
    }

    getTotalUsersCount() {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(DISTINCT username) as count 
                FROM short_urls
            `).get();
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting total users count:', error);
            return 0;
        }
    }

    getRecentUsers(limit = 10) {
        try {
            const result = this.db.prepare(`
                SELECT username, MAX(created_at) as last_activity
                FROM short_urls 
                GROUP BY username
                ORDER BY last_activity DESC 
                LIMIT ?
            `).all(limit);
            return result.map(row => row.username);
        } catch (error) {
            console.log('Error getting recent users:', error);
            return [];
        }
    }

    getAllTopLinks(limit = 10) {
        try {
            const results = this.db.prepare(`
                SELECT su.short, su.url, su.username, su.warning, su.created_at, COUNT(c.id) as clicks
                FROM short_urls su 
                LEFT JOIN clicks c ON su.id = c.short_url_id 
                GROUP BY su.id 
                ORDER BY clicks DESC, su.created_at DESC 
                LIMIT ?
            `).all(limit);
            return results || [];
        } catch (error) {
            console.log('Error getting all top links:', error);
            return [];
        }
    }

    getAllRecentLinks(limit = 20) {
        try {
            return this.db.prepare(`
                SELECT short, url, created_at, warning, username 
                FROM short_urls 
                ORDER BY created_at DESC 
                LIMIT ?
            `).all(limit);
        } catch (error) {
            console.log('Error getting all recent links:', error);
            return [];
        }
    }

    getLinksWithWarnings(limit = 20) {
        try {
            return this.db.prepare(`
                SELECT short, url, created_at, warning, username 
                FROM short_urls 
                WHERE warning = 1
                ORDER BY created_at DESC 
                LIMIT ?
            `).all(limit);
        } catch (error) {
            console.log('Error getting links with warnings:', error);
            return [];
        }
    }

    getUserLinksCount(username) {
        try {
            const result = this.db.prepare(`
                SELECT COUNT(*) as count 
                FROM short_urls 
                WHERE username = ?
            `).get(username);
            return result ? result.count : 0;
        } catch (error) {
            console.log('Error getting user links count:', error);
            return 0;
        }
    }

    getAllUsersWithLinks() {
        try {
            const users = this.db.prepare(`
                SELECT username, COUNT(*) as link_count, MAX(created_at) as last_activity
                FROM short_urls 
                GROUP BY username
                ORDER BY last_activity DESC
            `).all();
            
            // For each user, get their links
            const usersWithLinks = users.map(user => {
                const links = this.db.prepare(`
                    SELECT short, url, created_at, warning 
                    FROM short_urls 
                    WHERE username = ?
                    ORDER BY created_at DESC
                `).all(user.username);
                
                return {
                    username: user.username,
                    linkCount: user.link_count,
                    lastActivity: user.last_activity,
                    links: links
                };
            });
            
            return usersWithLinks;
        } catch (error) {
            console.log('Error getting all users with links:', error);
            return [];
        }
    }
}