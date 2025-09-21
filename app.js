// requires (modules)

require("dotenv").config();

const express = require("express");
const ejs = require("ejs");

const sqlite3 = require("sqlite3");

const colors = require("colors");

const path = require("path");
const fs = require("fs");

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

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})