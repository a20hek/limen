// content.ts
var LIMEN_REQUEST_TYPE = "LIMEN_FETCH_REDDIT";
var LIMEN_RESPONSE_TYPE = "LIMEN_FETCH_REDDIT_RESULT";
window.addEventListener("message", (event) => {
  if (event.source !== window)
    return;
  const data = event.data;
  if (!data || data.type !== LIMEN_REQUEST_TYPE) {
    return;
  }
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  const url = typeof data.url === "string" ? data.url : "";
  if (!requestId || !url) {
    return;
  }
  chrome.runtime.sendMessage({
    type: "FETCH_REDDIT_POST",
    requestId,
    url
  }, (response) => {
    if (chrome.runtime.lastError) {
      window.postMessage({
        type: LIMEN_RESPONSE_TYPE,
        requestId,
        ok: false,
        error: "Extension bridge is unavailable. Reload the extension and this page, then try again."
      }, window.location.origin);
      return;
    }
    if (!response || response.requestId !== requestId) {
      window.postMessage({
        type: LIMEN_RESPONSE_TYPE,
        requestId,
        ok: false,
        error: "Unexpected extension response."
      }, window.location.origin);
      return;
    }
    window.postMessage({
      type: LIMEN_RESPONSE_TYPE,
      requestId,
      ok: response.ok === true,
      payload: response.payload,
      error: response.error,
      status: response.status
    }, window.location.origin);
  });
});
