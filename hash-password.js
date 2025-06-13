const bcrypt = require('bcrypt');
const saltRounds = 10;
const plainPassword = '123'; // Ganti ini jika Anda ingin password lain

console.log(`Membuat hash untuk password: "${plainPassword}"`);

bcrypt.hash(plainPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error("Error hashing password:", err);
        return;
    }
    console.log("\nBERHASIL!");
    console.log("Salin seluruh baris di bawah ini dan tempel ke kolom 'password' di database Anda:");
    console.log(hash);
});