(() => {
  "use strict";
  const API = (window.IRC_CONFIG && window.IRC_CONFIG.apiBase || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  let adminToken = "";
  let suggestions = [];
  let events = [];
  let subscribers = [];
  let currentSuggestion = null;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  const dateText = value => {
    if (!value) return "Date to be confirmed";
    const d = new Date(value + "T12:00:00");
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
  };
  const eventRange = e => {
    if (!e.start_date) return "Date to be confirmed";
    if (!e.end_date || e.end_date === e.start_date) return dateText(e.start_date);
    return dateText(e.start_date) + " – " + dateText(e.end_date);
  };
  const statusClass = status => ["pending","reviewed","added","rejected"].includes(status) ? status : "";
  const statusLabel = status => ({pending:"Pending",reviewed:"Reviewed",added:"Added to calendar",rejected:"Rejected"}[status] || status || "Unknown");

  async function api(path, options = {}) {
    const headers = {...(options.headers || {}), Authorization:"Bearer " + adminToken};
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(API + path, {...options, headers});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
    return data;
  }
  function showMessage(element, message, kind = "") {
    element.textContent = message || "";
    element.className = "admin-message" + (kind ? " " + kind : "");
  }
  function themeSetup() {
    const saved = localStorage.getItem("irc-theme");
    if (saved === "dark") document.documentElement.dataset.theme = "dark";
    const button = $("theme-toggle");
    const icon = button.querySelector("span");
    const update = () => icon.textContent = document.documentElement.dataset.theme === "dark" ? "light_mode" : "dark_mode";
    update();
    button.addEventListener("click", () => {
      if (document.documentElement.dataset.theme === "dark") {
        delete document.documentElement.dataset.theme;
        localStorage.setItem("irc-theme","light");
      } else {
        document.documentElement.dataset.theme = "dark";
        localStorage.setItem("irc-theme","dark");
      }
      update();
    });
  }

  async function connect(token) {
    adminToken = token;
    // A protected read verifies the token before the dashboard is shown.
    await api("/api/admin/event-suggestions?status=all");
    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("logout-button").hidden = false;
    await refreshData();
  }
  async function refreshData() {
    showMessage($("dashboard-message"), "Refreshing dashboard…");
    try {
      const results = await Promise.all([
        api("/api/admin/event-suggestions?status=all"),
        api("/api/admin/events"),
        fetch("data/events.json",{cache:"no-store"}).then(r => {
          if (!r.ok) throw new Error("Could not read the published event snapshot.");
          return r.json();
        }),
        api("/api/admin/subscribers?status=all")
      ]);
      suggestions = results[0].suggestions || [];
      const overrides = results[1].events || [];
      const snapshot = results[2].events || [];
      subscribers = results[3].subscribers || [];
      const byId = new Map(snapshot.map(event => [event.id,event]));
      overrides.forEach(event => {
        if (!event || !event.id) return;
        byId.set(event.id,event);
      });
      events = [...byId.values()];
      renderAll();
      showMessage($("dashboard-message"), "Dashboard updated.", "success");
      window.setTimeout(() => showMessage($("dashboard-message"), ""), 2200);
    } catch (error) {
      showMessage($("dashboard-message"), error.message, "error");
    }
  }
  function renderAll() {
    $("stat-pending").textContent = suggestions.filter(s => s.status === "pending").length;
    $("stat-events").textContent = events.filter(e => !e.hidden).length;
    $("stat-reviewed").textContent = suggestions.filter(s => s.status === "reviewed" || s.status === "added" || s.status === "rejected").length;
    $("stat-subscribers").textContent = subscribers.length;
    $("tab-pending-count").textContent = suggestions.filter(s => s.status === "pending").length;
    $("tab-subscriber-count").textContent = subscribers.length;
    renderSuggestions();
    renderCalendar();
    renderSubscribers();
  }
  function detail(label, value, isUrl) {
    if (!value) return "";
    const shown = isUrl
      ? '<a href="' + escapeHtml(value) + '" target="_blank" rel="noopener noreferrer">Open link</a>'
      : escapeHtml(value);
    return '<div class="admin-detail"><b>' + label + '</b>' + shown + '</div>';
  }
  function safeImageDataUrl(value) {
    const source=String(value||"");
    return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)&&source.length<=820000 ? source : "";
  }
  function renderSuggestions() {
    const filter = $("suggestion-filter").value;
    const list = suggestions.filter(s => filter === "all" || s.status === filter);
    $("suggestion-list").innerHTML = list.map(s => {
      const title = s.event_name || "Event tip — details to be checked";
      const fields = [
        detail("Event date", s.event_date ? eventRange({start_date:s.event_date,end_date:s.event_date_end}) : ""),
        detail("Location", s.location),
        detail("Category", s.category || s.source_platform),
        detail("Organiser", s.organiser),
        detail("Contributor", s.contributor_name),
        detail("Contributor email", s.contributor_email),
        detail("Event source", s.source_url, true),
        detail("Poster image link", s.poster_url, true)
      ].join("");
      const imageUrl=safeImageDataUrl(s.image_data_url);
      const imageAttachment=imageUrl
        ? '<div class="suggestion-attachment"><a class="suggestion-image-link" href="' + escapeHtml(imageUrl) + '" target="_blank" rel="noopener noreferrer"><img src="' + escapeHtml(imageUrl) + '" alt="Event image submitted for review" loading="lazy"></a><div><b>' + escapeHtml(s.image_filename||"Event image") + '</b><small>Image supplied with this event tip</small><a href="' + escapeHtml(imageUrl) + '" download="' + escapeHtml(s.image_filename||"event-image") + '">Open or save image</a></div></div>'
        : "";
      const actions = s.status === "pending" || s.status === "reviewed"
        ? '<button class="action-button primary" data-action="approve" data-id="' + escapeHtml(s.id) + '"><span class="material-symbols-rounded">event_available</span> Review & add to calendar</button>' +
          '<button class="action-button" data-action="review" data-id="' + escapeHtml(s.id) + '">Mark reviewed</button>' +
          '<button class="action-button danger" data-action="reject" data-id="' + escapeHtml(s.id) + '">Reject</button>'
        : "";
      return '<article class="suggestion-card"><div class="card-top"><div><h3>' + escapeHtml(title) + '</h3><p class="card-subtitle">Submitted ' + escapeHtml(new Date(s.created_at).toLocaleString("en-IN")) + ' · ID ' + escapeHtml(s.id) + '</p></div><span class="status-chip ' + statusClass(s.status) + '">' + escapeHtml(statusLabel(s.status)) + '</span></div>' +
        '<div class="admin-detail-grid">' + fields + '</div>' +
        (s.details ? '<p class="admin-description">' + escapeHtml(s.details) + '</p>' : "") +
        imageAttachment +
        (s.review_note ? '<p class="card-subtitle">Review note: ' + escapeHtml(s.review_note) + '</p>' : "") +
        (actions ? '<div class="card-actions">' + actions + '</div>' : "") + '</article>';
    }).join("");
    $("suggestion-empty").hidden = list.length > 0;
  }
  function renderCalendar() {
    const query = $("calendar-search").value.trim().toLowerCase();
    const includeHidden = $("show-hidden").checked;
    const list = events.filter(e => includeHidden || !e.hidden)
      .filter(e => [e.title,e.location,e.organiser,e.state].join(" ").toLowerCase().includes(query))
      .sort((a,b) => (a.start_date || "").localeCompare(b.start_date || ""));
    $("calendar-list").innerHTML = list.map(event => {
      const hidden = Boolean(event.hidden);
      const categories = Array.isArray(event.categories) ? event.categories.join(", ") : "";
      return '<article class="calendar-card"><div class="card-top"><div><h3>' + escapeHtml(event.title) + '</h3><p class="card-subtitle">' + escapeHtml(eventRange(event)) + ' · ' + escapeHtml(event.location || "Location not supplied") + '</p></div><span class="status-chip ' + (hidden ? "rejected" : "") + '">' + (hidden ? "Hidden" : escapeHtml(event.status || "Confirmed")) + '</span></div>' +
        '<div class="admin-detail-grid">' + detail("Organiser",event.organiser) + detail("Category",event.discipline || categories) + detail("Official source",event.source_url,true) + detail("Registration",event.registration_url,true) + '</div>' +
        '<div class="card-actions"><button class="action-button" data-action="edit-event" data-id="' + escapeHtml(event.id) + '"><span class="material-symbols-rounded">edit</span> Edit</button>' +
        (hidden
          ? '<button class="action-button primary" data-action="restore-event" data-id="' + escapeHtml(event.id) + '"><span class="material-symbols-rounded">visibility</span> Restore</button>'
          : '<button class="action-button danger" data-action="hide-event" data-id="' + escapeHtml(event.id) + '"><span class="material-symbols-rounded">visibility_off</span> Hide from website</button>') +
        '</div></article>';
    }).join("");
    $("calendar-empty").hidden = list.length > 0;
  }
  function renderSubscribers() {
    const filter = $("subscriber-filter").value;
    const list = subscribers.filter(item => filter === "all" || item.status === filter);
    $("subscriber-list").innerHTML = list.map(item => {
      const status = ["pending","active","unsubscribed"].includes(item.status) ? item.status : "pending";
      const label = status === "pending" ? "Waiting list" : (status === "active" ? "Previously confirmed" : "Unsubscribed");
      const date = item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : "Date not available";
      return '<article class="subscriber-card"><div><strong>' + escapeHtml(item.email) + '</strong><small>Added ' + escapeHtml(date) + '</small></div><span class="status-chip ' + status + '">' + label + '</span></article>';
    }).join("");
    $("subscriber-empty").hidden = list.length > 0;
  }

  function activateTab(tab) {
    ["suggestions","calendar","subscribers"].forEach(name => {
      const active = tab === name;
      $(name + "-panel").hidden = !active;
      $("tab-" + name).classList.toggle("active",active);
      $("tab-" + name).setAttribute("aria-selected",String(active));
    });
  }

  function openEditor(event = {}, suggestion = null) {
    currentSuggestion = suggestion;
    const form = $("event-form");
    form.reset();
    const value = (key, fallback = "") => event[key] ?? fallback;
    $("event-id").value = event.id || "";
    $("suggestion-id").value = suggestion ? suggestion.id : "";
    $("event-dialog-title").textContent = suggestion ? "Approve and publish event" : (event.id ? "Edit calendar event" : "Add calendar event");
    $("event-title").value = value("title",suggestion?.event_name || "");
    $("event-start").value = value("start_date",suggestion?.event_date || "");
    $("event-end").value = value("end_date",suggestion?.event_date_end || "");
    $("event-location").value = value("location",suggestion?.location || "");
    $("event-state").value = value("state","");
    $("event-discipline").value = value("discipline",suggestion?.category || "");
    $("event-categories").value = Array.isArray(event.categories) ? event.categories.join(", ") : value("categories",suggestion?.category || "");
    $("event-organiser").value = value("organiser",suggestion?.organiser || "");
    $("event-description").value = value("description",suggestion?.details || "");
    $("event-source").value = value("source_url",suggestion?.source_url || "");
    $("event-registration").value = value("registration_url","");
    $("event-email").value = value("contact_email",suggestion?.organiser_email || "");
    $("event-phone").value = value("contact_phone",suggestion?.organiser_phone || "");
    $("event-poster").value = value("poster_url",suggestion?.poster_url || "");
    $("event-status").value = value("status","confirmed");
    $("event-hidden").checked = Boolean(event.hidden);
    showMessage($("event-form-message"),"");
    $("event-dialog").showModal();
  }
  function readEditor() {
    const form = $("event-form");
    const data = Object.fromEntries(new FormData(form).entries());
    data.categories = String(data.categories || "").split(",").map(x => x.trim()).filter(Boolean);
    data.hidden = $("event-hidden").checked;
    if (!data.end_date) data.end_date = data.start_date;
    return data;
  }
  async function handleSuggestionAction(button) {
    const id = button.dataset.id;
    const suggestion = suggestions.find(s => s.id === id);
    if (!suggestion) return;
    if (button.dataset.action === "approve") {
      openEditor({
        title:suggestion.event_name || "",
        start_date:suggestion.event_date || "",
        end_date:suggestion.event_date_end || "",
        location:suggestion.location || "",
        discipline:suggestion.category || "",
        organiser:suggestion.organiser || "",
        description:suggestion.details || "",
        source_url:suggestion.source_url || "",
        contact_email:suggestion.organiser_email || "",
        contact_phone:suggestion.organiser_phone || "",
        poster_url:suggestion.poster_url || ""
      },suggestion);
      return;
    }
    if (button.dataset.action === "reject" && !window.confirm("Reject this suggestion? It will stay in the database but will not be published.")) return;
    const status = button.dataset.action === "reject" ? "rejected" : "reviewed";
    await api("/api/admin/event-suggestions/" + encodeURIComponent(id),{
      method:"PATCH",body:JSON.stringify({status,review_note:status === "rejected" ? "Rejected in admin dashboard." : "Checked in admin dashboard."})
    });
    await refreshData();
  }
  async function handleCalendarAction(button) {
    const id = button.dataset.id;
    const event = events.find(e => e.id === id);
    if (!event) return;
    if (button.dataset.action === "edit-event") {
      openEditor(event);
      return;
    }
    if (button.dataset.action === "hide-event") {
      if (!window.confirm("Hide '" + event.title + "' from the public website? You can restore it later.")) return;
      await api("/api/admin/events",{method:"POST",body:JSON.stringify({...event,hidden:true})});
    }
    if (button.dataset.action === "restore-event") {
      await api("/api/admin/events",{method:"POST",body:JSON.stringify({...event,hidden:false})});
    }
    await refreshData();
  }

  $("login-form").addEventListener("submit",async event => {
    event.preventDefault();
    const input = $("admin-token");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const token = input.value.trim();
    if (!token) return;
    button.disabled = true;
    showMessage($("login-message"),"Checking your administrator token…");
    try {
      await connect(token);
      input.value = "";
      showMessage($("login-message"),"");
    } catch (error) {
      adminToken = "";
      showMessage($("login-message"),error.message === "Unauthorized." ? "That token was not accepted. Check it and try again." : error.message,"error");
    } finally {
      button.disabled = false;
    }
  });
  $("logout-button").addEventListener("click",() => {
    adminToken = "";
    suggestions = [];
    events = [];
    subscribers = [];
    $("dashboard").hidden = true;
    $("login-panel").hidden = false;
    $("logout-button").hidden = true;
    $("admin-token").value = "";
    showMessage($("login-message"),"You have signed out.");
  });
  $("refresh-button").addEventListener("click",refreshData);
  $("suggestion-filter").addEventListener("change",renderSuggestions);
  $("calendar-search").addEventListener("input",renderCalendar);
  $("show-hidden").addEventListener("change",renderCalendar);
  $("tab-suggestions").addEventListener("click",() => activateTab("suggestions"));
  $("tab-calendar").addEventListener("click",() => activateTab("calendar"));
  $("tab-subscribers").addEventListener("click",() => activateTab("subscribers"));
  $("subscriber-filter").addEventListener("change",renderSubscribers);
  $("add-event-button").addEventListener("click",() => openEditor());
  $("suggestion-list").addEventListener("click",async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    button.disabled = true;
    try { await handleSuggestionAction(button); }
    catch (error) { showMessage($("dashboard-message"),error.message,"error"); }
    finally { button.disabled = false; }
  });
  $("calendar-list").addEventListener("click",async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    button.disabled = true;
    try { await handleCalendarAction(button); }
    catch (error) { showMessage($("dashboard-message"),error.message,"error"); }
    finally { button.disabled = false; }
  });
  $("event-form").addEventListener("submit",async event => {
    event.preventDefault();
    const button = $("save-event-button");
    const data = readEditor();
    if (!data.title.trim() || !data.start_date) {
      showMessage($("event-form-message"),"Event name and start date are required.","error");
      return;
    }
    if (data.end_date && data.end_date < data.start_date) {
      showMessage($("event-form-message"),"End date cannot be before start date.","error");
      return;
    }
    button.disabled = true;
    showMessage($("event-form-message"),"Saving event…");
    try {
      const suggestionId = $("suggestion-id").value;
      if (suggestionId) {
        await api("/api/admin/event-suggestions/" + encodeURIComponent(suggestionId) + "/approve",{method:"POST",body:JSON.stringify(data)});
      } else {
        await api("/api/admin/events",{method:"POST",body:JSON.stringify(data)});
      }
      $("event-dialog").close();
      await refreshData();
      activateTab(suggestionId ? "suggestions" : "calendar");
    } catch (error) {
      showMessage($("event-form-message"),error.message,"error");
    } finally {
      button.disabled = false;
    }
  });
  $("close-dialog").addEventListener("click",() => $("event-dialog").close());
  $("cancel-dialog").addEventListener("click",() => $("event-dialog").close());
  $("event-dialog").addEventListener("click",event => {
    if (event.target === $("event-dialog")) $("event-dialog").close();
  });
  themeSetup();
})();