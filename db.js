const sqlite3 = require("better-sqlite3");
module.exports = class{
    init(){
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS short_urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short TEXT UNIQUE NOT NULL,
            url TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            warning BOOLEAN NOT NULL DEFAULT false,
            username TEXT NOT NULL DEFAULT "no-name"
            );
        `);
    }
    constructor(path){
        this.db = sqlite3(path);
        this.shortens = {};
        this["not-shortens"] = {}; // the exact opposite as of above :hs:
    }
    
}