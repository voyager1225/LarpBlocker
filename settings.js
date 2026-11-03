const statusMessage = document.getElementById("settings-status");
const allowedList = document.getElementById("allowed-list");
const blockedList = document.getElementById("blocked-list");
const allowedEmpty = document.getElementById("allowed-empty");
const blockedEmpty = document.getElementById("blocked-empty");

let blocklist;
let saveQueue = Promise.resolve();

function validateBlocklist(value) {
  if (
    !value ||
    !Array.isArray(value.allowedUrls) ||
    value.allowedUrls.some((url) => typeof url !== "string") ||
    !Array.isArray(value.blockedUrls) ||
    value.blockedUrls.some(
      (entry) =>
        !entry ||
        typeof entry.url !== "string" ||
        typeof entry.reason !== "string" ||
        !entry.reason.trim()
    )
  ) {
    throw new Error("The saved site lists have an invalid format.");
  }

  return value;
}

async function loadBlocklist() {
  const stored = await chrome.storage.local.get("blocklist");
  if (stored.blocklist) {
    return validateBlocklist(stored.blocklist);
  }

  const response = await fetch(chrome.runtime.getURL("list/blocklist.json"));
  if (!response.ok) {
    throw new Error(`Could not load the default site lists (${response.status}).`);
  }

  const defaults = validateBlocklist(await response.json());
  const latest = await chrome.storage.local.get("blocklist");
  if (latest.blocklist) {
    return validateBlocklist(latest.blocklist);
  }

  await chrome.storage.local.set({ blocklist: defaults });
  return defaults;
}

function normalizeSite(value) {
  const input = value.trim();
  if (!input) {
    throw new Error("Enter a website address.");
  }

  const hostnameInput = input.replace(/^(https?:\/\/)?\*\./i, "$1");
  const candidate = hostnameInput.includes("://")
    ? hostnameInput
    : `https://${hostnameInput}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid website address, such as example.com.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("Enter a valid HTTP or HTTPS website address.");
  }

  return `https://${url.hostname.toLowerCase()}`;
}

function hostnameFor(pattern) {
  const value = pattern.replace(/^\*/, "");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function findSiteIndex(entries, site) {
  const hostname = hostnameFor(site);
  return entries.findIndex((entry) => {
    const url = typeof entry === "string" ? entry : entry.url;
    try {
      return hostnameFor(url) === hostname;
    } catch {
      return false;
    }
  });
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function queueSave() {
  const snapshot = JSON.parse(JSON.stringify(blocklist));
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    showStatus("Saving…");
    try {
      await chrome.storage.local.set({ blocklist: snapshot });
      showStatus("Changes saved.");
    } catch (error) {
      console.error("Could not save site lists:", error);
      showStatus(`Could not save changes: ${error.message}`, true);
    }
  });
}

function createRemoveButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "site-remove-button";
  button.textContent = "Remove";
  button.setAttribute("aria-label", `Remove ${label}`);
  button.addEventListener("click", onClick);
  return button;
}

function renderLists() {
  allowedList.replaceChildren();
  for (const [index, site] of blocklist.allowedUrls.entries()) {
    const item = document.createElement("li");
    item.className = "site-list-item";
    const label = document.createElement("span");
    label.className = "site-list-url";
    label.textContent = site;
    item.append(
      label,
      createRemoveButton(site, () => {
        blocklist.allowedUrls.splice(index, 1);
        renderLists();
        queueSave();
      })
    );
    allowedList.append(item);
  }
  allowedEmpty.hidden = blocklist.allowedUrls.length > 0;

  blockedList.replaceChildren();
  for (const [index, entry] of blocklist.blockedUrls.entries()) {
    const item = document.createElement("li");
    item.className = "site-list-item blocked-list-item";
    const label = document.createElement("span");
    label.className = "site-list-url";
    label.textContent = entry.url;
    const reason = document.createElement("input");
    reason.className = "text-input blocked-reason-input";
    reason.type = "text";
    reason.value = entry.reason;
    reason.setAttribute("aria-label", `Block reason for ${entry.url}`);
    reason.addEventListener("change", () => {
      const newReason = reason.value.trim();
      if (!newReason) {
        reason.value = entry.reason;
        showStatus("A blocked site must have a reason.", true);
        return;
      }
      entry.reason = newReason;
      queueSave();
    });
    item.append(
      label,
      reason,
      createRemoveButton(entry.url, () => {
        blocklist.blockedUrls.splice(index, 1);
        renderLists();
        queueSave();
      })
    );
    blockedList.append(item);
  }
  blockedEmpty.hidden = blocklist.blockedUrls.length > 0;
}

document.getElementById("add-allowed-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const site = normalizeSite(document.getElementById("allowed-url").value);
    if (findSiteIndex(blocklist.allowedUrls, site) !== -1) {
      showStatus("That site is already allowed.", true);
      return;
    }

    const blockedIndex = findSiteIndex(blocklist.blockedUrls, site);
    if (blockedIndex !== -1) {
      blocklist.blockedUrls.splice(blockedIndex, 1);
    }
    blocklist.allowedUrls.push(site);
    event.currentTarget.reset();
    renderLists();
    queueSave();
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById("add-blocked-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const site = normalizeSite(document.getElementById("blocked-url").value);
    const reason = document.getElementById("blocked-reason").value.trim();
    if (!reason) {
      showStatus("Enter a reason for blocking this site.", true);
      return;
    }
    if (findSiteIndex(blocklist.blockedUrls, site) !== -1) {
      showStatus("That site is already blocked. Edit its reason in the list.", true);
      return;
    }

    const allowedIndex = findSiteIndex(blocklist.allowedUrls, site);
    if (allowedIndex !== -1) {
      blocklist.allowedUrls.splice(allowedIndex, 1);
    }
    blocklist.blockedUrls.push({ url: site, reason });
    event.currentTarget.reset();
    renderLists();
    queueSave();
  } catch (error) {
    showStatus(error.message, true);
  }
});

loadBlocklist()
  .then((loadedBlocklist) => {
    blocklist = loadedBlocklist;
    renderLists();
    showStatus("Changes save automatically.");
  })
  .catch((error) => {
    console.error("Could not load site lists:", error);
    showStatus(`Could not load site lists: ${error.message}`, true);
  });
