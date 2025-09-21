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

// setup

let app = express();
app.use(cookieParser());

// epic (static) endpoints

app.get("/",(req,res,next)=>{
    res.send("hiii")
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