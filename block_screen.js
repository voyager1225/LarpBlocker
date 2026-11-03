const params = new URLSearchParams(window.location.search);
const blockedUrl = params.get("url");
const reason = params.get("reason");

document.getElementById("blocked-url").textContent = blockedUrl || "Unknown URL";
document.getElementById("reason").textContent =
  reason || "This website is included in your configured blocklist.";
document.title = "Blocked | LarpBlocker";
