const db = require('./src/db/connection');
const total = db.prepare("SELECT count(*) as c FROM users").get();
console.log("Total users:", total.c);
const s8AZA = db.prepare("SELECT login, parent, name FROM users WHERE login LIKE '%8AZ%'").all();
console.log("8AZ matches:", s8AZA);
