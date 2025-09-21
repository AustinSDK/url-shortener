// requires (modules)

require("dotenv").config();

const express = require("express");
const ejs = require("ejs");

const colors = require("colors");

const path = require("path");
const fs = require("fs");

let db = require("./db")
db = new db(path.join(__dirname,"site.db"))

// setup

let app = express();

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

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})