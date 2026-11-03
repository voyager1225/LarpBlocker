chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: "settings.html"
  });
});

const blocklistPromise = fetch(chrome.runtime.getURL("list/blocklist.json"))
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load blocklist: ${response.status}`);
    }

    return response.json();
  })
  .then((blocklist) => {
    if (!Array.isArray(blocklist.blockedUrls)) {
      throw new Error("The blocklist must contain a blockedUrls array");
    }
    if (
      blocklist.blockedUrls.some(
        (entry) =>
          !entry ||
          typeof entry.url !== "string" ||
          typeof entry.reason !== "string" ||
          !entry.reason.trim()
      )
    ) {
      throw new Error("Each blockedUrls entry must contain a URL and a non-empty reason");
    }
    if (blocklist.allowedUrls !== undefined && !Array.isArray(blocklist.allowedUrls)) {
      throw new Error("The blocklist allowedUrls value must be an array");
    }

    return blocklist;
  });

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function getPatternHostname(pattern) {
  const trimmedPattern = pattern.trim();
  const hostnamePattern = trimmedPattern.replace(/^\*/, "").replace(/^\./, "");
  const url = new URL(
    hostnamePattern.includes("://") ? hostnamePattern : `https://${hostnamePattern}`
  );

  return normalizeHostname(url.hostname);
}

function findMatchingPattern(url, patterns) {
  for (const entry of patterns) {
    const pattern = typeof entry === "string" ? entry : entry?.url;
    if (typeof pattern !== "string") {
      console.warn("Ignoring non-string blocklist entry", pattern);
      continue;
    }

    try {
      const hostname = normalizeHostname(url.hostname);
      const patternHostname = getPatternHostname(pattern);
      if (hostname === patternHostname || hostname.endsWith(`.${patternHostname}`)) {
        return entry;
      }
    } catch (error) {
      console.warn(`Ignoring invalid blocklist entry: ${pattern}`, error);
    }
  }

  return null;
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  let destination;
  try {
    destination = new URL(details.url);
  } catch (error) {
    console.warn(`Ignoring invalid navigation URL: ${details.url}`, error);
    return;
  }

  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return;
  }

  void redirectIfBlocked(details.tabId, destination);
});

async function redirectIfBlocked(tabId, destination) {
  try {
    const blocklist = await blocklistPromise;
    if (findMatchingPattern(destination, blocklist.allowedUrls || [])) {
      return;
    }

    const matchedPattern = findMatchingPattern(destination, blocklist.blockedUrls);
    const reason = matchedPattern
      ? matchedPattern.reason
      : blocklist.unknownReason || "This website is not on the allowlist.";

    redirectToBlockPage(tabId, destination, reason);
  } catch (error) {
    console.error("Could not check the blocklist:", error);
    redirectToBlockPage(
      tabId,
      destination,
      "This website was blocked because its status could not be verified."
    );
  }
}

function redirectToBlockPage(tabId, destination, reason) {
  const blockPage = new URL(chrome.runtime.getURL("block_screen.html"));
  blockPage.searchParams.set("url", destination.href);
  blockPage.searchParams.set("reason", reason);

  chrome.tabs.update(tabId, { url: blockPage.href }, () => {
    if (chrome.runtime.lastError) {
      console.error("Could not redirect blocked navigation:", chrome.runtime.lastError.message);
    }
  });
}
