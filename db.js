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
}