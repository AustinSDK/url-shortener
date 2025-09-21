// requires (modules)

require("dotenv").config();

const express = require("express");
const ejs = require("ejs");

const sqlite3 = require("sqlite3");

const colors = require("colors");

// setup

let app = express();

// epic endpoints

app.get("/",(req,res,next)=>{
    res.send("hiii")
})

// listen

app.listen(process.env.port,e=>{
    if (e){
        return console.error(colors.red(`Error... ${colors.underline(e)}`))
    }
    console.log(colors.green(`Now hosting on port ${colors.underline(process.env.port)}. ${colors.underline(`http://localhost:${process.env.port}`)}`))
})