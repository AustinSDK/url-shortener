const sqlite3 = require("better-sqlite3");
module.exports = class{
    constructor(path){
        this.db = sqlite3(path);
    }
}