export default async function runBrowserSmoke(page) {
  const origin = "http://127.0.0.1:4173";
  const localLoginValue = "local-workout";
  let targetDate = "";
  let activityRef = "";
  let stage = "setup";

  const mutationRequests = [];
  const consoleProblems = [];
  const pageErrors = [];
  let unauthorizedResponses = 0;

  const invariant = (condition, message) => {
    if (!condition) throw new Error(`[browser-smoke:${stage}] ${message}`);
  };
  const safeStage = async (name, operation) => {
    stage = name;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[browser-smoke:")) throw error;
      throw new Error(`[browser-smoke:${name}] the browser action did not complete`);
    }
  };
  const requestPath = (request) => new URL(request.url()).pathname;
  const mutationFor = (command, offset = 0) => mutationRequests.filter(
    (request) => request.path.endsWith(`/${command}`),
  ).at(offset);
  const validMutationKey = (value) => typeof value === "string"
    && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
  const pauseBoundary = (body) => {
    try {
      const parsed = JSON.parse(body);
      if (Object.keys(parsed).length !== 1 || typeof parsed.close_at !== "string") return null;
      return Number.isNaN(Date.parse(parsed.close_at)) ? null : parsed.close_at;
    } catch {
      return null;
    }
  };
  const sessionReadback = async (sessionKey) => page.evaluate(async (key) => {
    const response = await fetch(`/api/private/sessions/${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { responseStatus: response.status };
    const detail = await response.json();
    return {
      responseStatus: response.status,
      sessionStatus: detail.status,
      intervalCount: Array.isArray(detail.training_intervals) ? detail.training_intervals.length : -1,
      openIntervalCount: Array.isArray(detail.training_intervals)
        ? detail.training_intervals.filter((interval) => interval.ended_at === null).length
        : -1,
    };
  }, sessionKey);

  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(12_000);
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    if (/401\s*\(Unauthorized\)/i.test(message.text())) return;
    consoleProblems.push(message.type());
  });
  page.on("pageerror", () => pageErrors.push("pageerror"));
  page.on("request", (request) => {
    const path = requestPath(request);
    if (request.method() !== "POST") return;
    if (!/^\/api\/private\/(?:scheduled-workouts\/\d{4}-\d{2}-\d{2}\/start|sessions\/[^/]+\/(?:pause|resume))$/.test(path)) return;
    const headers = request.headers();
    mutationRequests.push({
      path,
      body: request.postData() ?? "",
      key: headers["idempotency-key"] ?? "",
    });
  });
  page.on("response", (response) => {
    if (response.status() === 401 && requestPath(response.request()).startsWith("/api/private/")) {
      unauthorizedResponses += 1;
    }
  });

  await safeStage("configuration", async () => {
    invariant(typeof origin === "string" && origin === "http://127.0.0.1:4173", "the fixed preview origin is unavailable");
    invariant(typeof localLoginValue === "string" && localLoginValue.length > 0, "the local preview login fixture is unavailable");
  });

  await safeStage("shell", async () => {
    await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "登录你的训练空间", exact: true }).waitFor();
    invariant(new URL(page.url()).pathname === "/app", "the application route did not mount");
    invariant(await page.title() === "Workout Tracker", "the application title is incorrect");
    invariant(await page.locator("#app").isVisible(), "the Vue shell is blank");
    invariant(await page.locator("vite-error-overlay, .vite-error-overlay, [data-vite-dev-id]").count() === 0, "a framework error overlay is visible");
    invariant(pageErrors.length === 0 && consoleProblems.length === 0, "the initial shell reported a console failure");
  });

  await safeStage("login", async () => {
    await page.getByLabel("邮箱", { exact: true }).fill("athlete-a@example.invalid");
    await page.getByLabel("密码", { exact: true }).fill(localLoginValue);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "本地演示训练", exact: true }).waitFor();
    const applicationCookies = await page.context().cookies();
    invariant(applicationCookies.filter((cookie) => cookie.name === "workout_session" && cookie.value.length > 0).length === 1, "the application session cookie was not established");
    const today = await page.evaluate(async () => {
      const response = await fetch("/api/private/today", { headers: { Accept: "application/json" } });
      if (!response.ok) return { status: response.status, date: null };
      const body = await response.json();
      return { status: response.status, date: body.date };
    });
    invariant(today.status === 200 && typeof today.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today.date), "the public Today date is unavailable");
    targetDate = today.date;
    activityRef = `browser-smoke-aerobic-${targetDate}`;
  });

  await safeStage("aerobic-sync", async () => {
    const dataAsOf = new Date().toISOString();
    const projection = {
      schema_version: 1,
      publication_key: `training-archive:${targetDate}`,
      source_ref: `training-archive:${targetDate}`,
      target_date: targetDate,
      timezone: "Asia/Shanghai",
      source_status: "complete",
      source_statuses: { workout: "complete", coros: "complete" },
      workout_source_status: "complete",
      source_data_as_of: {
        workout: dataAsOf,
        coros: dataAsOf,
      },
      data_as_of: dataAsOf,
      routes: [{
        schema_version: 1,
        route_key: "香山演示线",
        route_name: "香山演示线",
        sport_types: [102],
        distance_range_km: [8.5, 9.5],
      }],
      activities: [{
        schema_version: 1,
        activity_ref: activityRef,
        source_ref: `coros:activity:${activityRef}`,
        local_date: targetDate,
        timezone: "Asia/Shanghai",
        started_at: new Date(`${targetDate}T00:15:00+08:00`).toISOString(),
        ended_at: new Date(`${targetDate}T01:20:00+08:00`).toISOString(),
        sport_type: 102,
        sport_name: "trail_run",
        source_status: "complete",
        data_as_of: dataAsOf,
        updated_at: dataAsOf,
        summary: {
          duration_sec: 3900,
          total_duration_sec: null,
          distance_km: 9.2,
          average_heart_rate_bpm: 151,
          max_heart_rate_bpm: null,
          calories_kcal: 640,
          training_load: null,
          aerobic_te: null,
          anaerobic_te: null,
          training_focus: null,
          perceived_effort: null,
          sport_metrics: { running: { average_pace_sec_per_km: 424 } },
        },
        route_key: "香山演示线",
        route_direction: "forward",
        route_match_status: "matched",
        fit_status: "complete",
      }],
    };
    const result = await page.evaluate(async ({ value, key }) => {
      const response = await fetch("/api/private/records/aerobic/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ projection: value }),
      });
      const body = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        code: body?.error?.code ?? null,
        details: Array.isArray(body?.error?.details) ? body.error.details : [],
      };
    }, { value: projection, key: `browser-smoke-aerobic-${targetDate}` });
    invariant(
      result.ok && result.status === 200,
      `the real aerobic projection was not accepted (${result.status} ${result.code ?? "unknown"} ${JSON.stringify(result.details)})`,
    );
  });

  await safeStage("calendar-records", async () => {
    await page.getByRole("button", { name: "日历", exact: true }).click();
    await page.getByRole("heading", { name: "日历", exact: true }).first().waitFor();
    const dateButton = page.locator(`[data-action="calendar-select"][data-date="${targetDate}"]`);
    await dateButton.waitFor();
    invariant((await dateButton.innerText()).includes("1 次有氧"), "the Calendar day did not expose the synced aerobic count");
    const summary = page.locator(`[aria-label="${targetDate} 有氧摘要"]`);
    await summary.waitFor();
    invariant((await summary.innerText()).includes("1 次活动"), "the Calendar aerobic summary is incomplete");

    await page.locator(`[data-action="open-aerobic-date"][data-date="${targetDate}"]`).click();
    await page.locator(".records-page h1", { hasText: "有氧" }).waitFor();
    const dateScope = page.locator(".aerobic-date-scope");
    await dateScope.waitFor();
    invariant((await dateScope.innerText()).includes(targetDate), "the Records date bridge lost the selected Calendar date");

    const activityCard = page.locator(`[data-action="aerobic-detail"][data-activity-ref="${activityRef}"]`);
    await activityCard.waitFor();
    invariant((await activityCard.innerText()).includes("9.2 km"), "the synced activity is missing from Records");
    await activityCard.click();
    await page.getByRole("heading", { name: "活动详情", exact: true }).waitFor();
    const detail = page.locator(".aerobic-detail-card");
    invariant((await detail.innerText()).includes("9.2 km"), "the activity detail lost its distance");
    invariant((await detail.innerText()).includes("香山演示线"), "the activity detail lost its matched route");
  });

  await safeStage("session-start", async () => {
    await page.getByRole("button", { name: "今日", exact: true }).click();
    await page.getByRole("heading", { name: "本地演示训练", exact: true }).waitFor();
    const startResponse = page.waitForResponse((response) => (
      requestPath(response.request()) === `/api/private/scheduled-workouts/${targetDate}/start`
      && response.request().method() === "POST"
    ));
    await page.locator('[data-action="start"]').click();
    invariant((await startResponse).status() === 201, "the server did not create the Session");
    await page.locator('[data-action="minimize"]').waitFor();

    const startRequest = mutationFor("start");
    invariant(Boolean(startRequest), "the Session start request was not observed");
    invariant(startRequest.body === "{}", "the Session start body changed");
    invariant(validMutationKey(startRequest.key), "the Session start idempotency key is missing or unsafe");
  });

  let sessionKey = "";
  let firstPauseKey = "";
  await safeStage("minimize-pause", async () => {
    const pauseResponse = page.waitForResponse((response) => (
      /^\/api\/private\/sessions\/[^/]+\/pause$/.test(requestPath(response.request()))
      && response.request().method() === "POST"
    ));
    await page.locator('[data-action="minimize"]').click();
    invariant((await pauseResponse).status() === 200, "minimizing did not persist a paused Session");
    await page.locator("nav.bottom-nav").waitFor();

    const pauses = mutationRequests.filter((request) => request.path.endsWith("/pause"));
    invariant(pauses.length === 1, "minimizing did not issue exactly one pause request");
    invariant(pauseBoundary(pauses[0].body) !== null, "the minimize pause boundary is missing or invalid");
    invariant(validMutationKey(pauses[0].key), "the minimize pause idempotency key is missing or unsafe");
    invariant(pauses[0].key !== mutationFor("start").key, "start and pause reused one idempotency key");
    sessionKey = pauses[0].path.split("/").at(-2) ?? "";
    firstPauseKey = pauses[0].key;
    invariant(sessionKey.length > 0, "the created Session identifier is unavailable");

    await page.getByRole("button", { name: "日历", exact: true }).click();
    await page.getByRole("heading", { name: "日历", exact: true }).first().waitFor();
    invariant(mutationRequests.filter((request) => request.path.endsWith("/pause")).length === 1, "navigation duplicated an already completed pause");

    const readback = await sessionReadback(sessionKey);
    invariant(readback.responseStatus === 200 && readback.sessionStatus === "in_progress", "the minimized Session cannot be read back");
    invariant(readback.openIntervalCount === 0 && readback.intervalCount === 1, "the minimized Session still owns an open interval");
  });

  let resumeCountBeforePageShow = 0;
  await safeStage("pagehide-pause", async () => {
    await page.getByRole("button", { name: "今日", exact: true }).click();
    const openSession = page.locator('[data-action="open-session"]');
    await openSession.waitFor();
    await openSession.click();
    const timerToggle = page.locator('[data-action="toggle-timer"]');
    await timerToggle.waitFor();
    invariant((await timerToggle.innerText()).trim() === "继续", "the minimized Session did not reopen in a paused state");

    const resumeResponse = page.waitForResponse((response) => (
      requestPath(response.request()) === `/api/private/sessions/${sessionKey}/resume`
      && response.request().method() === "POST"
    ));
    await timerToggle.click();
    invariant((await resumeResponse).status() === 200, "the Session did not resume through the server");
    await page.locator('[data-action="toggle-timer"]:not([aria-pressed="true"])').waitFor();
    const resumeRequest = mutationFor("resume");
    invariant(Boolean(resumeRequest) && resumeRequest.body === "{}", "the Session resume body changed");
    invariant(validMutationKey(resumeRequest.key), "the Session resume idempotency key is missing or unsafe");

    const pausesBeforePageHide = mutationRequests.filter((request) => request.path.endsWith("/pause")).length;
    const pagehideResponse = page.waitForResponse((response) => (
      requestPath(response.request()) === `/api/private/sessions/${sessionKey}/pause`
      && response.request().method() === "POST"
    ));
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    invariant((await pagehideResponse).status() === 200, "pagehide did not deliver the keepalive pause");
    const pausesAfterPageHide = mutationRequests.filter((request) => request.path.endsWith("/pause"));
    invariant(pausesAfterPageHide.length === pausesBeforePageHide + 1, "pagehide did not issue exactly one new pause request");
    const pagehidePause = pausesAfterPageHide.at(-1);
    invariant(pauseBoundary(pagehidePause.body) !== null, "the pagehide pause boundary is missing or invalid");
    invariant(validMutationKey(pagehidePause.key), "the pagehide pause idempotency key is missing or unsafe");
    invariant(pagehidePause.key !== firstPauseKey && pagehidePause.key !== resumeRequest.key, "pagehide reused an unrelated mutation key");

    const readback = await sessionReadback(sessionKey);
    invariant(readback.responseStatus === 200 && readback.sessionStatus === "in_progress", "the pagehide Session cannot be read back");
    invariant(readback.openIntervalCount === 0 && readback.intervalCount === 2, "pagehide left a server interval open");
    resumeCountBeforePageShow = mutationRequests.filter((request) => request.path.endsWith("/resume")).length;
  });

  await safeStage("pageshow", async () => {
    const reconciliationResponse = page.waitForResponse((response) => (
      requestPath(response.request()) === `/api/private/sessions/${sessionKey}`
      && response.request().method() === "GET"
    ));
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    invariant((await reconciliationResponse).status() === 200, "pageshow did not reconcile the Session read model");
    const timerToggle = page.locator('[data-action="toggle-timer"]');
    await timerToggle.waitFor();
    invariant((await timerToggle.innerText()).trim() === "继续", "pageshow silently resumed the visible timer");
    invariant(await timerToggle.getAttribute("aria-pressed") === "true", "pageshow changed the paused control state");
    invariant(mutationRequests.filter((request) => request.path.endsWith("/resume")).length === resumeCountBeforePageShow, "pageshow sent an automatic resume request");
    const readback = await sessionReadback(sessionKey);
    invariant(readback.responseStatus === 200 && readback.openIntervalCount === 0, "pageshow reopened the authoritative Session interval");
  });

  await safeStage("cookie-expiry", async () => {
    invariant(pageErrors.length === 0 && consoleProblems.length === 0, "the authenticated flow reported a console failure");
    const unauthorizedBeforeClear = unauthorizedResponses;
    await page.context().clearCookies();
    const unauthorized = page.waitForResponse((response) => (
      response.status() === 401 && requestPath(response.request()).startsWith("/api/private/")
    ));
    await page.reload({ waitUntil: "domcontentloaded" });
    await unauthorized;
    await page.getByRole("heading", { name: "登录你的训练空间", exact: true }).waitFor();
    invariant(unauthorizedResponses > unauthorizedBeforeClear, "clearing the application cookie did not reach the 401 boundary");
    const applicationCookies = await page.context().cookies();
    invariant(applicationCookies.every((cookie) => cookie.name !== "workout_session"), "the cleared application cookie returned unexpectedly");
    invariant(await page.locator("#app").isVisible(), "the login shell is blank after the 401 transition");
  });
}
