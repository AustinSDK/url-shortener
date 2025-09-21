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
        `);
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
        const result = this.db.prepare(`INSERT INTO short_urls (id, short,url,warning,username) VALUES (?,?,?,?,?)`).run(randomString(64),slug,url,warning ? 1 : 0,username);
        
        // Add to cache
        this.shortens[slug] = {
            id: result.lastInsertRowid,
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
}