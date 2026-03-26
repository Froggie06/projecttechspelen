const btn = document.getElementById("showSecurity")
const form = document.getElementById("securityForm")

if (btn && form) {
    btn.addEventListener("click", () => {
        if (form.style.display === "none") {
            form.style.display = "flex"
            btn.textContent = "Verberg"
        } else {
            form.style.display = "none"
            btn.textContent = "Verander wachtwoord of gebruikersnaam"
        }
    })
}

