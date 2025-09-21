// requires (modules)

require("dotenv").config();

const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");

const colors = require("colors");

const path = require("path");
const fs = require("fs");

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
app.use(cookieParser());
app.use(async (req,res,next)=>{
    if (!req.cookies || !req.cookies.token){
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
    res.render("index.ejs")
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
        res.send("check cookies?")
    } catch (error) {
        console.log('Oops, something went wrong:', error);
        res.send(error,":(")
    }
})

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})