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
    if (_short.warning === 1){
        return res.send("extra check")
    }
    res.redirect(_short.url)
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
app.get("/dashboard/stats", (req, res, next) => {
    const stats = {
        "Total Shortened URLs": 1234,
        "Total Redirects": 5678,
        "Active Users": 42,
        "Unique Visitors": 314,
        "Most Popular URL": "abc123",
        "URLs Created Today": 12
    };
    res.render("dashboard/stats.ejs", { stats,user:req.user, test:test });
});
app.get("/dashboard/links", (req, res, next) => {
    const links = db.getShortsByUsername(req.user.username)
    res.render("dashboard/links.ejs", { links:links,user:req.user, test:test });
});
app.get("/dashboard/link/:short", (req, res, next) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return res.status(404).render("404.ejs", { user: req.user, test: test });
    }
    
    // Check if user owns the link or has admin permissions
    const canAccess = link.username === req.user.username || 
                     req.user.permissions.includes("admin") || 
                     req.user.permissions.includes("url-admin");
    
    if (!canAccess) {
        return res.status(403).render("403.ejs", { user: req.user, test: test });
    }
    
    // Mock stats data for easy backend editing
    const mockStats = {
        totalClicks: Math.floor(Math.random() * 1000) + 50,
        todayClicks: Math.floor(Math.random() * 50) + 5,
        thisWeekClicks: Math.floor(Math.random() * 200) + 20,
        topReferrers: [
            { name: "Direct", count: Math.floor(Math.random() * 100) + 10 },
            { name: "Google", count: Math.floor(Math.random() * 80) + 5 },
            { name: "Twitter", count: Math.floor(Math.random() * 60) + 3 },
            { name: "Facebook", count: Math.floor(Math.random() * 40) + 2 }
        ],
        clickHistory: Array.from({length: 7}, (_, i) => ({
            date: new Date(Date.now() - (6-i) * 24 * 60 * 60 * 1000).toLocaleDateString(),
            clicks: Math.floor(Math.random() * 30) + 5
        })),
        browsers: [
            { name: "Chrome", percentage: 65 },
            { name: "Firefox", percentage: 18 },
            { name: "Safari", percentage: 12 },
            { name: "Edge", percentage: 5 }
        ]
    };
    
    res.render("dashboard/link.ejs", { 
        link: link, 
        user: req.user, 
        test: test, 
        stats: mockStats,
        isOwner: link.username === req.user.username,
        isAdmin: req.user.permissions.includes("admin") || req.user.permissions.includes("url-admin"),
        req: req
    });
});

// Edit link endpoint
app.post("/api/link/:short/edit", (req, res) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return res.status(404).json({ success: false, message: "Link not found" });
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
    
    try {
        db.modifyShort(link.id, req.params.short, url, link.username, warning ? 1 : 0);
        res.json({ success: true, message: "Link updated successfully" });
    } catch (error) {
        console.error("Error updating link:", error);
        res.status(500).json({ success: false, message: "Failed to update link" });
    }
});

// Delete link endpoint
app.delete("/api/link/:short", (req, res) => {
    const link = db.getShort(req.params.short);
    if (!link) {
        return res.status(404).json({ success: false, message: "Link not found" });
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

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})