// requires (modules)

require("dotenv").config();

const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");

const colors = require("colors");

const path = require("path");
const fs = require("fs");

let test = process.argv.includes("-t");

let db = require("./db");
db = new db(path.join(__dirname,"site.db"));

const Auth = require("@austinsdk/auth");
const { error } = require("console");
const auth = new Auth(
    process.env.auth_server_url,
    process.env.client_id,
    process.env.client_secret,
    process.env.callback
)

// User cache system (similar to db.js pattern)
const userCache = {
    users: {}, // cached user data by token
    invalidTokens: [], // tokens that returned null/error
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
    
    get(token) {
        // Check if token is known to be invalid
        if (this.invalidTokens.includes(token)) {
            return { valid: false, user: null };
        }
        
        // Check if we have cached user data
        const cached = this.users[token];
        if (cached) {
            // Check if cache is still valid
            if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
                return { valid: true, user: cached.user };
            } else {
                // Cache expired, remove it
                delete this.users[token];
            }
        }
        
        return null; // No cache data
    },
    
    set(token, user) {
        if (user) {
            // Cache valid user data
            this.users[token] = {
                user: user,
                timestamp: Date.now()
            };
            // Remove from invalid tokens if it was there
            const index = this.invalidTokens.indexOf(token);
            if (index > -1) {
                this.invalidTokens.splice(index, 1);
            }
        } else {
            // Mark token as invalid (but don't cache indefinitely)
            if (!this.invalidTokens.includes(token)) {
                this.invalidTokens.push(token);
            }
            // Clean up old invalid tokens periodically (keep only last 100)
            if (this.invalidTokens.length > 100) {
                this.invalidTokens = this.invalidTokens.slice(-50);
            }
        }
    },
    
    clear(token) {
        delete this.users[token];
        const index = this.invalidTokens.indexOf(token);
        if (index > -1) {
            this.invalidTokens.splice(index, 1);
        }
    }
};

// setup

let app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(async (req,res,next)=>{
    if (!req.cookies || !req.cookies.token){
        req.user = false;
        return next();
    }
    
    const token = req.cookies.token;
    
    // Try to get user from cache first
    const cachedResult = userCache.get(token);
    if (cachedResult !== null) {
        req.user = cachedResult.user;
        return next();
    }
    
    // Not in cache, fetch from API
    try{
        req.user = await auth.getUserInfo(token);
        if (req.user.status == "error"){
            req.user = false;
        }
        // Cache the result (whether it's a user object or null/undefined)
        userCache.set(token, req.user);
    } catch (e){
        console.error(e);
        // Cache the error result as null
        userCache.set(token, null);
    }
    next();
})

// epic (static) endpoints

app.get("/",(req,res,next)=>{
    if (!req.user){
        return res.redirect("/login")
    }
    return res.redirect("/dashboard/stats")
})
app.get("/css/:path",(req,res,next)=>{
    let f_path = path.join(__dirname,"assets","css");
    let _path = path.join(f_path,req.params.path);
    if (!path.normalize(_path).startsWith(f_path)){
        return res.status(403).json(
            {
                "type":"error",
                "error":"Invalid url D:"
            }
        )
    }
    return res.sendFile(_path)
})
app.get("/js/:path",(req,res,next)=>{
    let f_path = path.join(__dirname,"assets","js");
    let _path = path.join(f_path,req.params.path);
    if (!path.normalize(_path).startsWith(f_path)){
        return res.status(403).json(
            {
                "type":"error",
                "error":"Invalid url D:"
            }
        )
    }
    return res.sendFile(_path)
})
app.get("/u/:short",(req,res,next)=>{
    let _short = db.getShort(req.params.short);
    if (!_short){
        return res.send("invalid url")
    }
    
    // Record click statistics
    const hashedIp = require('crypto').createHash('sha256').update(req.ip || 'unknown').digest('hex');
    const browser = req.get('User-Agent') ? req.get('User-Agent').split(' ')[0] : 'unknown';
    const referrer = req.get('Referer') || 'Direct';
    
    try {
        db.recordClick(_short.id, hashedIp, browser, referrer);
    } catch (error) {
        console.error('Failed to record click:', error);
    }
    
    if (_short.warning === 1){
        res.cookie("_redirect",_short.url)
        return res.redirect("/approve")
    }
    res.redirect(_short.url)
})
app.get("/approve",(req,res,next)=>{
    if (!req.cookies || !req.cookies._redirect){
        return res.redirect("/404")
    }
    // Prevent XSS by encoding the URL before rendering
    const rawUrl = req.cookies._redirect;
    // Only allow http/https URLs and block javascript: etc.
    let safeUrl = "No URL found, or invalid url format found.";
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            safeUrl = encodeURI(rawUrl);
        }
    } catch (e) {
        safeUrl = "No URL found, or invalid url format found.";
    }
    // Prevent CSRF: this endpoint only reads a cookie and renders a page, but if you later POST to approve, use CSRF tokens!
    res.render("approve.ejs", { link: safeUrl });
})

// cool login stuff ig
app.get("/login",(req,res,next)=>{
    const authUrl = auth.getAuthUrl();
    return res.redirect(authUrl)
})
app.get("/callback/auth",async (req,res,next)=>{
    let _code = req.query.code;
    let tokenResponse;
    try {
        tokenResponse = await auth.codeForToken(_code);
        if (!tokenResponse.access_token) throw error("invalid auth?")
        res.cookie("token",tokenResponse.access_token);
        res.redirect("/")
    } catch (error) {
        console.log('Oops, something went wrong:', error);
        res.send(error,":(")
    }
})

// cool dashboard stuff
app.get("/dashboard/:db",(req,res,next)=>{
    if (!req.user){
        return res.redirect("/login");
    }
    return next();
})
app.post("/dashboard/:db",(req,res,next)=>{
    if (!req.user){
        return res.redirect("/login");
    }
    return next();
})
app.get("/dashboard/stats", (req, res, next) => {
    try {
        // Get user-specific statistics (only their links)
        const userLinks = db.getShortsByUsername(req.user.username);
        const userLinkIds = userLinks.map(link => link.id);
        
        // If user has no links, show empty dashboard
        if (userLinkIds.length === 0) {
            const dashboardData = {
                basicStats: {
                    "Total Shortened URLs": 0,
                    "Total Redirects": 0,
                    "URLs Created Today": 0,
                    "Average Clicks per URL": 0
                },
                mostPopular: null,
                recentLinks: [],
                topLinks: [],
                browserStats: [],
                referrerStats: [],
                clickTrends: []
            };
            return res.render("dashboard/stats.ejs", { 
                dashboardData, 
                user: req.user, 
                test: test 
            });
        }
        
        // Get comprehensive user-specific statistics
        const totalLinks = userLinks.length;
        const totalClicks = db.getUserTotalClicks(req.user.username);
        const linksToday = db.getUserLinksCreatedToday(req.user.username);
        const mostPopular = db.getUserMostPopularLink(req.user.username);
        
        // Get recent links (user's last 10)
        const recentLinks = db.getUserRecentLinks(req.user.username, 10);
        
        // Get user's top performing links with click counts
        const topLinks = db.getUserTopLinks(req.user.username, 5);
        
        // Get browser statistics across user's links
        const browserStats = db.getUserBrowserStats(req.user.username);
        
        // Get referrer statistics across user's links
        const referrerStats = db.getUserReferrerStats(req.user.username, 10);
        
        // Get temporal data - clicks over the last 7 days for user's links
        const clickTrends = db.getUserClickTrends(req.user.username, 7);
        
        // Format data for dashboard
        const dashboardData = {
            // Basic metrics
            basicStats: {
                "Total Shortened URLs": totalLinks,
                "Total Redirects": totalClicks,
                "URLs Created Today": linksToday,
                "Average Clicks per URL": totalLinks > 0 ? Math.round(totalClicks / totalLinks) : 0
            },
            
            // Most popular link info
            mostPopular: mostPopular || null,
            
            // Recent activity
            recentLinks: recentLinks || [],
            
            // Top performing links
            topLinks: topLinks || [],
            
            // Browser distribution
            browserStats: browserStats || [],
            
            // Traffic sources
            referrerStats: referrerStats || [],
            
            // Temporal trends
            clickTrends: clickTrends || []
        };
        
        res.render("dashboard/stats.ejs", { 
            dashboardData, 
            user: req.user, 
            test: test 
        });
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        // Fallback to basic stats on error
        const stats = {
            "Total Shortened URLs": 0,
            "Total Redirects": 0,
            "URLs Created Today": 0,
            "Most Popular URL": "No data yet"
        };
        res.render("dashboard/stats.ejs", { 
            dashboardData: { basicStats: stats, mostPopular: null, recentLinks: [], topLinks: [], browserStats: [], referrerStats: [], clickTrends: [] },
            user: req.user, 
            test: test 
        });
    }
});
app.get("/dashboard/links", (req, res, next) => {
    const links = db.getShortsByUsername(req.user.username)
    res.render("dashboard/links.ejs", { links:links,user:req.user, test:test });
});
app.get("/dashboard/create", (req, res, next) => {
    return res.render("dashboard/create.ejs",{
        user:req.user,
        test:test, 
        isAdmin: req.user.permissions.includes("admin") || req.user.permissions.includes("url-admin")
    })
});
app.post("/dashboard/create", (req, res, next) => {
    let log = console.log
    if (!test){
        log = ()=>{} // dont flood console ig
    }
    let _warning = false;
    if (!req.body || !req.body.slug || !req.body.url){
        log("Redirecting: Missing slug or url in request body");
        return res.redirect("");
    }
    const slugPattern = /^[A-Za-z0-9_-]+$/;
    if (!slugPattern.test(req.body.slug)) {
        log("Redirecting: Invalid slug format");
        return res.redirect(""); // Invalid slug
    }

    // Validate URL: must be http or https, not javascript: or other protocols
    let urlValid = false;
    try {
        const parsedUrl = new URL(req.body.url);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
            urlValid = true;
        }
    } catch (e) {
        urlValid = false;
    }
    if (!urlValid) {
        log("Redirecting: Invalid URL format");
        return res.redirect(""); // Invalid URL
    }
    if (req.body.warning == "true"){
        _warning = true
    }
    if (!req.user.permissions.includes("admin") && !req.user.permissions.includes("url-admin")){
        _warning = false
    }
    let _short = db.getShort(req.body.slug);
    if (_short){
        log("Pre existing url :(")
        return res.redirect("")
    }
    db.addShort(req.body.slug,req.body.url,req.user.username,_warning)
    return res.redirect("/dashboard/link/"+req.body.slug)
});
app.get("/dashboard/link/:short", (req, res, next) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return next();
    }
    
    // Check if user owns the link or has admin permissions
    const canAccess = link.username === req.user.username || 
                     req.user.permissions.includes("admin") || 
                     req.user.permissions.includes("url-admin");
    
    if (!canAccess) {
        return res.status(403).render("403.ejs", { user: req.user, test: test });
    }
    
    // Get real statistics data
    const totalClicks = db.getTotalClicksForShort(link.id);
    const todayClicks = db.getClicksForShortToday(link.id);
    const thisWeekClicks = db.getClicksForShortByDateRange(link.id, 7);
    const topReferrers = db.getTopReferrersForShort(link.id, 4);
    const clickHistory = db.getClickHistoryForShort(link.id, 7);
    const browsers = db.getBrowserStatsForShort(link.id);
    
    // Format referrers data
    const formattedReferrers = topReferrers.length > 0 ? topReferrers.map(ref => ({
        name: ref.refer_link === 'unknown' ? 'Direct' : ref.refer_link,
        count: ref.count
    })) : [
        { name: "Direct", count: 0 },
        { name: "No data yet", count: 0 }
    ];
    
    // Format click history with proper dates
    const formattedClickHistory = Array.from({length: 7}, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split('T')[0];
        const found = clickHistory.find(ch => ch.day === dateStr);
        return {
            date: date.toLocaleDateString(),
            clicks: found ? found.clicks : 0
        };
    });
    
    // Format browser data or use defaults if no data
    const formattedBrowsers = browsers.length > 0 ? browsers : [
        { name: "No data yet", percentage: 100 }
    ];
    
    const realStats = {
        totalClicks: totalClicks,
        todayClicks: todayClicks,
        thisWeekClicks: thisWeekClicks,
        topReferrers: formattedReferrers,
        clickHistory: formattedClickHistory,
        browsers: formattedBrowsers
    };
    
    res.render("dashboard/link.ejs", { 
        link: link, 
        user: req.user, 
        test: test, 
        stats: realStats,
        isOwner: link.username === req.user.username,
        isAdmin: req.user.permissions.includes("admin") || req.user.permissions.includes("url-admin"),
        req: req
    });
});

// Edit link endpoint
app.post("/api/link/:short/edit", (req, res, next) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return next()
    }
    
    // Check permissions
    const canEdit = link.username === req.user.username || 
                   req.user.permissions.includes("admin") || 
                   req.user.permissions.includes("url-admin");
    
    if (!canEdit) {
        return res.status(403).json({ success: false, message: "You don't have permission to edit this link" });
    }
    
    const { url, warning } = req.body;
    
    // Validate input
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, message: "Valid URL is required" });
    }
    
    // Check if user is trying to change warning setting
    const isChangingWarning = warning !== undefined && (warning ? 1 : 0) !== link.warning;
    const isAdmin = req.user.permissions.includes("admin") || req.user.permissions.includes("url-admin");
    
    if (isChangingWarning && !isAdmin) {
        return res.status(403).json({ success: false, message: "Only admins can modify warning settings" });
    }
    
    // Use existing warning value if not admin or not provided
    const finalWarning = isAdmin && warning !== undefined ? (warning ? 1 : 0) : link.warning;
    
    try {
        db.modifyShort(link.id, req.params.short, url, link.username, finalWarning);
        res.json({ success: true, message: "Link updated successfully" });
    } catch (error) {
        console.error("Error updating link:", error);
        res.status(500).json({ success: false, message: "Failed to update link" });
    }
});

// Delete link endpoint
app.delete("/api/link/:short", (req, res, next) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return next();
    }
    
    // Check permissions
    const canDelete = link.username === req.user.username || 
                     req.user.permissions.includes("admin") || 
                     req.user.permissions.includes("url-admin");
    
    if (!canDelete) {
        return res.status(403).json({ success: false, message: "You don't have permission to delete this link" });
    }
    
    try {
        db.removeShort(link.id);
        res.json({ success: true, message: "Link deleted successfully" });
    } catch (error) {
        console.error("Error deleting link:", error);
        res.status(500).json({ success: false, message: "Failed to delete link" });
    }
});

if (test){
    app.get("/me",(req,res,next)=>{
        res.json(req.user)
    })
}

app.get(/.*/, (req, res) => {
    res.status(404).render("404.ejs", { user: req.user, test: test });
});

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})