const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH_MESSAGES_SELECT =
  "id,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead,importance";

async function readJson(response, serviceName) {
  if (!response || !response.ok) {
    const status = response?.status || "网络错误";
    const error = new Error(`${serviceName}邮件接口返回 HTTP ${status}`);
    error.status = response?.status;
    throw error;
  }
  return response.json();
}

async function fetchGmailIncremental({ accessToken, cursor, fetchImpl }) {
  const requestOptions = { headers: { Authorization: `Bearer ${accessToken}` } };
  if (cursor && !/^\d+$/.test(String(cursor))) cursor = null;
  if (!cursor) {
    const listUrl = `${GMAIL_API_BASE}/messages?maxResults=15&q=${encodeURIComponent("in:inbox OR in:spam")}`;
    // Capture the history baseline before listing. Mail arriving after this
    // baseline is either present in the list or returned by the next history call.
    const profileData = await fetchImpl(`${GMAIL_API_BASE}/profile`, requestOptions)
      .then((response) => readJson(response, "Gmail "));
    const listData = await fetchImpl(listUrl, requestOptions)
      .then((response) => readJson(response, "Gmail "));
    return {
      messageIds: (listData.messages || []).map((message) => message.id).filter(Boolean),
      cursor: String(profileData.historyId || "") || null,
      reset: false,
      bootstrap: true,
    };
  }

  const messageIds = new Set();
  let pageToken = null;
  let latestHistoryId = String(cursor);
  try {
    do {
      const params = new URLSearchParams({
        startHistoryId: String(cursor),
        historyTypes: "messageAdded",
        maxResults: "500",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await fetchImpl(`${GMAIL_API_BASE}/history?${params.toString()}`, requestOptions)
        .then((response) => readJson(response, "Gmail "));
      for (const history of data.history || []) {
        for (const added of history.messagesAdded || []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }
      latestHistoryId = String(data.historyId || latestHistoryId);
      pageToken = data.nextPageToken || null;
    } while (pageToken);
  } catch (error) {
    if (error.status !== 404) throw error;
    const resetResult = await fetchGmailIncremental({ accessToken, cursor: null, fetchImpl });
    return { ...resetResult, reset: true, bootstrap: true };
  }
  return { messageIds: [...messageIds], cursor: latestHistoryId, reset: false, bootstrap: false };
}

function getPendingGmailBootstrap(account) {
  if (
    !Array.isArray(account?.syncPendingMessageIds) ||
    account.syncPendingMessageIds.length === 0 ||
    !/^\d+$/.test(String(account.syncBootstrapCursor || ""))
  ) {
    return null;
  }
  return {
    messageIds: [...new Set(account.syncPendingMessageIds.filter(Boolean))],
    cursor: String(account.syncBootstrapCursor),
    reset: false,
    bootstrap: true,
  };
}

function stageGmailBootstrap(account, incremental) {
  if (!incremental?.bootstrap || !Array.isArray(incremental.messageIds) || incremental.messageIds.length === 0) {
    return false;
  }
  account.syncBootstrapCursor = incremental.cursor;
  account.syncPendingMessageIds = [...new Set(incremental.messageIds.filter(Boolean))];
  return true;
}

function clearGmailBootstrap(account) {
  account.syncBootstrapCursor = null;
  account.syncPendingMessageIds = [];
}

async function fetchMicrosoftDelta({ accessToken, cursor, fetchImpl, maxPages = 10, bootstrap = !cursor }) {
  const requestOptions = { headers: { Authorization: `Bearer ${accessToken}` } };
  if (cursor && !/^https:\/\/graph\.microsoft\.com\//i.test(String(cursor))) cursor = null;
  let url = cursor || `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?changeType=created&$select=${encodeURIComponent(GRAPH_MESSAGES_SELECT)}&$top=25`;
  const messages = [];
  let pages = 0;
  let nextCursor = cursor || null;
  try {
    while (url && pages < maxPages) {
      const data = await fetchImpl(url, requestOptions).then((response) => readJson(response, "Microsoft "));
      for (const item of data.value || []) {
        if (item?.id && !item["@removed"]) messages.push(item);
      }
      pages += 1;
      nextCursor = data["@odata.deltaLink"] || data["@odata.nextLink"] || nextCursor;
      url = data["@odata.nextLink"] || null;
      if (data["@odata.deltaLink"]) break;
    }
  } catch (error) {
    if (error.status !== 410 || !cursor) throw error;
    return fetchMicrosoftDelta({ accessToken, cursor: null, fetchImpl, maxPages, bootstrap: true });
  }
  return {
    messages,
    cursor: nextCursor,
    complete: Boolean(nextCursor && String(nextCursor).includes("$deltatoken")),
    bootstrap,
  };
}

module.exports = {
  clearGmailBootstrap,
  fetchGmailIncremental,
  fetchMicrosoftDelta,
  getPendingGmailBootstrap,
  stageGmailBootstrap,
};
