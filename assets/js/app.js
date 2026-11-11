(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const today = new Date(); today.setHours(0,0,0,0);
  const fmt = (value) => { if (!value) return "Date to be confirmed"; const d = new Date(value + "T12:00:00"); return d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); };
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = (value) => { try { const u = new URL(String(value || ""), window.location.href); return ["https:","http:","mailto:"].includes(u.protocol) ? safe(u.href) : "#"; } catch { return "#"; } };
  const base = (window.IRC_CONFIG && window.IRC_CONFIG.apiBase || "").replace(/\/$/,"");
  async function load(kind) {
    // Read the published snapshot first, then overlay any admin-managed D1 records.
    const snapshotResponse = await fetch("data/"+kind+".json",{cache:"no-store"});
    if(!snapshotResponse.ok) throw new Error("Could not load "+kind);
    const snapshot = await snapshotResponse.json();
    if (base) {
      try {
        const response = await fetch(base+"/api/"+kind,{headers:{Accept:"application/json"}});
        if (response.ok) {
          const live = await response.json();
          if (kind === "events" && Array.isArray(live.events)) {
            const merged = new Map((snapshot.events || []).map(event => [event.id,event]));
            live.events.forEach(event => {
              if (!event || !event.id) return;
              if (event.hidden) merged.delete(event.id);
              else merged.set(event.id,event);
            });
            return {...snapshot,events:[...merged.values()]};
          }
          if (Array.isArray(live[kind]) && live[kind].length) return live;
        }
      } catch(error) {
        console.warn("API unavailable; using published snapshot.",error);
      }
    }
    return snapshot;
  }
  function dateRange(e){ if(e.date_note) return e.date_note; if(!e.start_date) return "Dates to be confirmed"; if(!e.end_date) return "Starts "+fmt(e.start_date); return e.start_date===e.end_date ? fmt(e.start_date) : fmt(e.start_date)+" – "+fmt(e.end_date); }
  function links(e){
    const items=[];
    if(e.source_url) items.push({label:e.source_name||"Official event website",url:e.source_url,image_url:e.source_preview_url||e.image_url||"",kind:"Official source"});
    (e.source_links||[]).forEach(l=>{if(l.url)items.push({label:l.label||"Original announcement",url:l.url,image_url:l.image_url||e.image_url||"",kind:l.kind||"Source link"});});
    if(!items.length)return "";
    return '<div class="source-previews" aria-label="Original event sources">'+items.map(item=>{
      const thumb=item.image_url
        ? '<img src="'+safeUrl(item.image_url)+'" alt="" loading="lazy" referrerpolicy="no-referrer">'
        : '<span class="material-symbols-rounded" aria-hidden="true">article</span>';
      return '<a class="source-preview-card" href="'+safeUrl(item.url)+'" target="_blank" rel="noopener"><span class="source-preview-thumb">'+thumb+'</span><span class="source-preview-body"><small>'+safe(item.kind)+'</small><b>'+safe(item.label)+'</b><span>Open original ↗</span></span></a>';
    }).join("")+'</div>';
  }
  function eventCard(e){
    const poster=e.poster_url?'<img src="'+safeUrl(e.poster_url)+'" alt="'+safe(e.title)+' official event poster" loading="lazy" referrerpolicy="no-referrer">':(e.image_url?'<img src="'+safeUrl(e.image_url)+'" alt="'+safe(e.image_note||e.title+" official event visual")+'" loading="lazy" referrerpolicy="no-referrer"><span class="poster-caption">Official event visual · not a poster</span>':'<span class="material-symbols-rounded">pedal_bike</span><span class="poster-caption">Poster not supplied by source</span>');
    const register=e.registration_url?'<a class="button button-filled" href="'+safeUrl(e.registration_url)+'" target="_blank" rel="noopener">Register <span class="material-symbols-rounded">open_in_new</span></a>':(e.contact_email?'<a class="button button-filled" href="'+safeUrl("mailto:"+e.contact_email)+'">Contact organiser <span class="material-symbols-rounded">mail</span></a>':"");
    const phone=e.contact_phone?'<div class="detail-row"><span class="material-symbols-rounded">call</span><span>'+safe(e.contact_phone)+'</span></div>':"";
    const sourceLabel = e.status === "postponed" ? '<span class="chip">Postponed — check organiser</span>' : (e.status === "cancelled" ? '<span class="chip">Cancelled</span>' : (e.confidence === "cfi-calendar-image" ? '<span class="chip">CFI Calendar 2026–27</span>' : (e.confidence === "community-screenshot" ? '<span class="chip">Community archive</span>' : '<span class="chip confirmed">Source checked</span>')));
    const categoryList = (Array.isArray(e.categories) ? e.categories : [e.discipline || "Cycling"]).filter(c=>String(c).toLowerCase()!==String(e.event_scope||"").toLowerCase());
    const categories=categoryList.map(c=>'<span class="chip">'+safe(c)+'</span>').join("");
    const calendarLabels={international:"International event",national:"National event",camp:"Coaching camp",private:"Private event"};
    const calendarType=e.calendar_category ? '<span class="chip cfi-'+safe(e.calendar_category)+'">'+safe(calendarLabels[e.calendar_category]||e.calendar_category)+'</span>' : "";
    const scopeChip=e.event_scope&&String(e.event_scope).toLowerCase()!==String(e.calendar_category||"").toLowerCase() ? '<span class="chip">'+safe(e.event_scope)+'</span>' : "";
    const uciChip=e.uci_accredited ? '<span class="chip">UCI accredited</span>' : "";
    return '<article class="event-card"><div class="event-poster">'+poster+'</div><div class="event-body"><div class="event-meta"><span class="event-date">'+safe(dateRange(e))+'</span>'+sourceLabel+'</div><div class="event-meta">'+categories+'</div><h3>'+safe(e.title)+'</h3><p class="event-description">'+safe(e.description||"Open the official source for event information.")+'</p><div class="event-details"><div class="detail-row"><span class="material-symbols-rounded">location_on</span><span>'+safe(e.location||"Location to be confirmed")+'</span></div><div class="detail-row"><span class="material-symbols-rounded">groups</span><span>'+safe(e.organiser||"Organiser details on official source")+'</span></div>'+phone+(e.verified_at ? '<div class="detail-row"><span class="material-symbols-rounded">fact_check</span><span>Last verified: '+safe(fmt(e.verified_at))+'</span></div>' : (e.confidence === "cfi-calendar-image" ? '<div class="detail-row"><span class="material-symbols-rounded">fact_check</span><span>Source: CFI Calendar 2026–27 image</span></div>' : ""))+'</div><div class="event-actions">'+register+(e.source_url?'<a class="button button-tonal" href="'+safeUrl(e.source_url)+'" target="_blank" rel="noopener">Event details <span class="material-symbols-rounded">open_in_new</span></a>':"")+'</div>'+links(e)+'</div></article>';
  }
  function upcomingEventTable(list){
    const labels={international:"International",national:"National",camp:"Camp",private:"Private"};
    const header='<table class="event-table"><thead><tr><th scope="col">Date</th><th scope="col">Event / organiser</th><th scope="col">Discipline</th><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Links</th></tr></thead><tbody>';
    const rows=list.map(e=>{
      const categoryList=(Array.isArray(e.categories)?e.categories:[]).filter(c=>String(c).toLowerCase()!==String(e.event_scope||"").toLowerCase());
      const sub=[e.discipline,...categoryList].filter(Boolean).join(" · ");
      const type=labels[e.calendar_category]||"Event";
      const typeClass=e.calendar_category?"event-type-"+safe(e.calendar_category):"";
      const source=e.source_url?'<a class="table-action" href="'+safeUrl(e.source_url)+'" target="_blank" rel="noopener">Details ↗</a>':"";
      const register=e.registration_url?'<a class="table-action" href="'+safeUrl(e.registration_url)+'" target="_blank" rel="noopener">Register ↗</a>':"";
      const extra=e.uci_accredited?'<span class="table-mini-badge">UCI</span>':"";
      const status=e.status==="postponed"?"Postponed":(e.status==="cancelled"?"Cancelled":"");
      return '<tr><td class="event-table-date">'+safe(dateRange(e))+'</td><td class="event-table-name"><strong>'+safe(e.title)+'</strong><small>'+safe(e.organiser||"Organiser to be confirmed")+'</small><small class="event-table-mobile-meta">'+safe(sub)+'</small><span class="event-table-mobile-type '+typeClass+'">'+safe(type)+'</span></td><td>'+safe(sub||e.discipline||"To be confirmed")+'</td><td>'+safe(e.location||"To be confirmed")+'</td><td><span class="event-type '+typeClass+'">'+safe(type)+'</span>'+extra+(status?'<small class="event-table-status">'+safe(status)+'</small>':"")+'</td><td class="event-table-links">'+source+register+'</td></tr>';
    }).join("");
    return header+rows+'</tbody></table>';
  }
  function pastEventTable(list){
    const header='<table class="event-table past-event-table"><thead><tr><th scope="col">Date</th><th scope="col">Event / organiser</th><th scope="col">Discipline</th><th scope="col">Location</th><th scope="col">Result / note</th><th scope="col">Links</th></tr></thead><tbody>';
    const rows=list.map(e=>{
      const cats=(Array.isArray(e.categories)?e.categories:[]).filter(c=>String(c).toLowerCase()!==String(e.event_scope||"").toLowerCase());
      const discipline=[e.discipline,...cats].filter(Boolean).join(" · ");
      const result=safe(e.result||e.result_note||e.results||"Completed");
      const source=e.source_url?'<a class="table-action" href="'+safeUrl(e.source_url)+'" target="_blank" rel="noopener">Source ↗</a>':"";
      const register=e.registration_url?'<a class="table-action" href="'+safeUrl(e.registration_url)+'" target="_blank" rel="noopener">Results ↗</a>':"";
      const extra=e.verified_at?'<small class="event-table-status">Verified '+safe(fmt(e.verified_at))+'</small>':"";
      return '<tr><td class="event-table-date">'+safe(dateRange(e))+'</td><td class="event-table-name"><strong>'+safe(e.title)+'</strong><small>'+safe(e.organiser||"Organiser not recorded")+'</small><small class="event-table-mobile-meta">'+safe(discipline)+' · '+result+'</small></td><td>'+safe(discipline||"—")+'</td><td>'+safe(e.location||"Not recorded")+'</td><td><span class="event-result-note">'+result+'</span>'+extra+'</td><td class="event-table-links">'+source+register+'</td></tr>';
    }).join("");
    return header+rows+'</tbody></table>';
  }
  function empty(title,desc,icon){return '<div class="empty-state"><span class="material-symbols-rounded">'+icon+'</span><h3>'+title+'</h3><p>'+desc+'</p></div>';}
  function setTheme(){const saved=localStorage.getItem("irc-theme");if(saved==="dark")document.documentElement.dataset.theme="dark";const btn=$("theme-toggle");if(btn)btn.addEventListener("click",()=>{const dark=document.documentElement.dataset.theme!=="dark";if(dark)document.documentElement.dataset.theme="dark";else delete document.documentElement.dataset.theme;localStorage.setItem("irc-theme",dark?"dark":"light");btn.querySelector("span").textContent=dark?"light_mode":"dark_mode";});if(btn&&document.documentElement.dataset.theme==="dark")btn.querySelector("span").textContent="light_mode";}
  async function initUpcoming(){
    const grid=$("event-grid");grid.classList.add("event-table-shell");let events=[];
    try{const d=await load("events");events=d.events||d;const meta=d.meta||{};const upcoming=events.filter(e=>(e.status==="postponed" || (e.end_date ? new Date(e.end_date+"T23:59:59")>=today : e.status!=="completed"))&&e.status!=="cancelled");$("upcoming-count").textContent=upcoming.length;$("updated-date").textContent=meta.last_updated?fmt(meta.last_updated):"—";const states=[...new Set(upcoming.map(e=>e.state).filter(Boolean))];$("state-count").textContent=states.length?states.length+" states":"All India";const state=$("state-filter");states.sort().forEach(s=>state.add(new Option(s,s)));render();}
    catch(err){grid.innerHTML=empty("Calendar could not load","Please refresh the page. The event data file may be temporarily unavailable.","cloud_offline");$("event-error").hidden=false;$("event-error").textContent=err.message;}
    function render(){const q=$("event-search").value.trim().toLowerCase(),cat=$("category-filter").value,state=$("state-filter").value;const list=events.filter(e=>(e.end_date ? new Date(e.end_date+"T23:59:59")>=today : e.status!=="completed")&&e.status!=="cancelled").filter(e=>(!q||[e.title,e.location,e.organiser,e.description].join(" ").toLowerCase().includes(q))&&(!cat||(e.discipline||"").toLowerCase().includes(cat.toLowerCase())||(e.categories||[]).some(c=>c.toLowerCase().includes(cat.toLowerCase())))&&(!state||e.state===state)).sort((a,b)=>(a.start_date||"9999-12-31").localeCompare(b.start_date||"9999-12-31"));grid.innerHTML=list.length?upcomingEventTable(list):empty("No matching events","Try a different search or filter. New listings appear after a source has been checked.","event_busy");}
    ["event-search","category-filter","state-filter"].forEach(id=>$(id).addEventListener(id==="event-search"?"input":"change",render));
  }
  async function initPast(){
    const grid=$("past-grid");grid.classList.add("event-table-shell");let events=[];
    try{
      const d=await load("events");events=d.events||d;
      events=events.filter(e=>e.status==="completed"||e.status==="cancelled"||(e.status!=="postponed"&&e.end_date&&new Date(e.end_date+"T23:59:59")<today));
      const years=[...new Set(events.map(e=>e.start_date?.slice(0,4)).filter(Boolean))].sort().reverse();
      years.forEach(y=>$("year-filter").add(new Option(y,y)));
      const states=[...new Set(events.map(e=>e.state).filter(Boolean))].sort();
      states.forEach(s=>$("past-state-filter").add(new Option(s,s)));
      render();
    }catch(err){grid.innerHTML=empty("Archive could not load","Please refresh the page.","cloud_offline");$("past-error").hidden=false;$("past-error").textContent=err.message;}
    function render(){
      const q=$("past-search").value.trim().toLowerCase(),year=$("year-filter").value,category=$("past-category-filter").value,state=$("past-state-filter").value;
      const list=events.filter(e=>(!q||[e.title,e.location,e.organiser,e.description].join(" ").toLowerCase().includes(q)))
        .filter(e=>(!year||String(e.start_date||"").startsWith(year)))
        .filter(e=>(!category||(e.discipline||"").toLowerCase().includes(category.toLowerCase())||(e.categories||[]).some(c=>String(c).toLowerCase().includes(category.toLowerCase()))))
        .filter(e=>(!state||e.state===state))
        .sort((a,b)=>(b.start_date||"").localeCompare(a.start_date||""));
      grid.innerHTML=list.length?pastEventTable(list):empty("No matching past events","Try another search, year, discipline or state.","event_busy");
    }
    ["past-search","year-filter","past-category-filter","past-state-filter"].forEach(id=>$(id).addEventListener(id==="past-search"?"input":"change",render));
  }
    async function initNews(){
    const grid=$("news-grid");let items=[];
    try{const d=await load("news");items=d.news||d;render();}
    catch(err){grid.innerHTML=empty("News could not load","Please refresh the page.","cloud_offline");$("news-error").hidden=false;$("news-error").textContent=err.message;}
    function render(){const q=$("news-search").value.trim().toLowerCase(),type=$("news-type-filter").value;const list=items.filter(n=>(!q||[n.title,n.publisher,n.summary].join(" ").toLowerCase().includes(q))&&(!type||n.type===type)).sort((a,b)=>(b.published_at||"").localeCompare(a.published_at||""));grid.innerHTML=list.length?list.map(n=>'<article class="news-card"><div class="news-card-top"><span class="news-category">'+safe(n.category||"Cycling update")+'</span><time datetime="'+safe(n.published_at||"")+'">'+safe(fmt(n.published_at))+'</time></div><h3>'+safe(n.title)+'</h3><p class="news-source">Published by '+safe(n.publisher||"Original source")+'</p><p class="news-description">'+safe(n.summary||"Open the original article for the full update.")+'</p><div class=\"news-card-links\"><a class=\"news-link\" href=\"'+safeUrl(n.source_url)+'\" target=\"_blank\" rel=\"noopener\">'+safe(n.source_label || (n.type === \"video\" ? \"Watch video\" : \"Read original report\"))+' <span class=\"material-symbols-rounded\">'+(n.type === \"video\" ? \"play_circle\" : \"arrow_outward\")+'</span></a>'+(n.video_url?'<a class=\"news-link\" href=\"'+safeUrl(n.video_url)+'\" target=\"_blank\" rel=\"noopener\">'+safe(n.video_label||\"Watch video\")+' <span class=\"material-symbols-rounded\">play_circle</span></a>':\"\")+'</div></article>').join(""):empty("No matching stories","New race news and announcements will appear here as sources are reviewed.","newspaper");}
    ["news-search","news-type-filter"].forEach(id=>$(id).addEventListener(id==="news-search"?"input":"change",render));
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(new Error("The image could not be read. Please try another file."));reader.readAsDataURL(file);});
  }
  async function compressSuggestionImage(file) {
    if(!file||!String(file.type||"").startsWith("image/")) throw new Error("Please choose an image file.");
    if(file.size>12*1024*1024) throw new Error("Please choose an image smaller than 12 MB.");
    let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error("This image format could not be opened. Please try a JPG, PNG or WebP screenshot.");}
    try{
      for(const maxSide of [1600,1400,1200,1000,900]){
        const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image processing is not available in this browser.");
        ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        for(const quality of [0.88,0.82,0.76,0.70,0.64,0.58]){
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
          if(blob&&blob.size<=580*1024)return readFileAsDataUrl(new File([blob],"event-screenshot.jpg",{type:"image/jpeg"}));
        }
      }
    }finally{bitmap.close?.();}
    throw new Error("The image could not be compressed enough. Please use a smaller screenshot.");
  }
  function suggestionForm(){
    const form=$("event-suggestion-form");if(!form)return;
    const msg=$("suggestion-message"),inputBox=$("suggest-event-input"),imageInput=$("suggest-image"),contactBox=$("suggest-contact");
    const preview=$("suggest-image-preview"),previewImage=$("suggest-image-thumb"),previewName=$("suggest-image-name"),previewSize=$("suggest-image-size");
    let previewUrl="";
    function setMessage(t,c="form-message form-message-dark"){msg.textContent=t;msg.className=c;}
    function clearImage(){
      imageInput.value="";
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl="";preview.hidden=true;previewImage.removeAttribute("src");previewName.textContent="";previewSize.textContent="";
    }
    function attachImage(file){
      if(!file||!String(file.type||"").startsWith("image/")){setMessage("Please choose or paste an image file.","form-message form-message-dark error");return false;}
      if(file.size>12*1024*1024){setMessage("Please choose an image smaller than 12 MB.","form-message form-message-dark error");return false;}
      try{const transfer=new DataTransfer();transfer.items.add(file);imageInput.files=transfer.files;imageInput.dispatchEvent(new Event("change",{bubbles:true}));return true;}
      catch{setMessage("This browser could not attach the image. Please use Upload screenshot / photo.","form-message form-message-dark error");return false;}
    }
    imageInput.addEventListener("change",()=>{
      const file=imageInput.files?.[0];if(!file){clearImage();return;}
      if(!String(file.type||"").startsWith("image/")||file.size>12*1024*1024){clearImage();setMessage("Please choose an image file smaller than 12 MB.","form-message form-message-dark error");return;}
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=URL.createObjectURL(file);previewImage.src=previewUrl;previewName.textContent=file.name||"Pasted screenshot";
      previewSize.textContent=(file.size/1024/1024).toFixed(2)+" MB · compressed before sending";preview.hidden=false;
      setMessage("Image attached. Add a note or link, or send it now.");
    });
    $("remove-suggest-image").addEventListener("click",clearImage);
    inputBox.addEventListener("paste",ev=>{
      const item=Array.from(ev.clipboardData?.items||[]).find(x=>x.kind==="file"&&/^image\//i.test(x.type));
      if(item){const file=item.getAsFile();if(file){ev.preventDefault();attachImage(file);}}
    });
    inputBox.addEventListener("dragover",ev=>{
      if(Array.from(ev.dataTransfer?.items||[]).some(x=>x.kind==="file"&&/^image\//i.test(x.type))){ev.preventDefault();inputBox.classList.add("dragging");}
    });
    inputBox.addEventListener("dragleave",()=>inputBox.classList.remove("dragging"));
    inputBox.addEventListener("drop",ev=>{
      inputBox.classList.remove("dragging");
      const file=Array.from(ev.dataTransfer?.files||[]).find(f=>String(f.type||"").startsWith("image/"));
      if(file){ev.preventDefault();attachImage(file);}
    });
    inputBox.addEventListener("input",()=>inputBox.classList.toggle("has-content",Boolean(inputBox.innerText.trim())));
    form.addEventListener("submit",async ev=>{
      ev.preventDefault();
      const submit=form.querySelector('button[type="submit"]');
      const details=String(inputBox.innerText||inputBox.textContent||"").trim().slice(0,5000);
      const selectedFile=imageInput.files?.[0]||null;
      const contributorContact=String(contactBox?.value||"").trim().slice(0,500);
      if(!details&&!selectedFile){setMessage("Please write about the event, paste its link, paste a screenshot, or upload a screenshot/photo. One option is enough.","form-message form-message-dark error");inputBox.focus();return;}
      let sourceUrl="";const match=details.match(/https?:\/\/[^\s<>"']+/i);if(match)sourceUrl=match[0].replace(/[),.;!?]+$/,"");
      if(sourceUrl){
        try{const parsed=new URL(sourceUrl);if(!["https:","http:"].includes(parsed.protocol))throw new Error("Invalid link");sourceUrl=parsed.href;}
        catch{setMessage("The event link is not valid. Please paste the full link beginning with https://.","form-message form-message-dark error");inputBox.focus();return;}
      }
      if(!base){setMessage("The secure submission service is not connected. Your tip has not been sent.","form-message form-message-dark error");return;}
      setMessage(selectedFile?"Preparing screenshot and sending your event tip…":"Sending your event tip…");submit.disabled=true;
      try{
        const payload={details,source_url:sourceUrl,contributor_contact:contributorContact};
        if(selectedFile){payload.image_data_url=await compressSuggestionImage(selectedFile);payload.image_filename=(selectedFile.name||"event-screenshot.jpg").slice(0,160);}
        const response=await fetch(base+"/api/event-suggestions",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"Your event tip could not be sent. Please try again.");
        setMessage("Thank you! Your event tip has reached our private review inbox. We will check it before adding it to the calendar.","form-message form-message-dark success");
        form.reset();inputBox.textContent="";inputBox.classList.remove("has-content");clearImage();
      }catch(error){setMessage(error.message||"Your event tip could not be sent. Please try again later.","form-message form-message-dark error");}
      finally{submit.disabled=false;}
    });
  }
    function newsletter(){
    const form=$("newsletter-form");
    if(!form)return;
    form.addEventListener("submit",async ev=>{
      ev.preventDefault();
      const msg=$("newsletter-message");
      const email=$("newsletter-email").value.trim();
      const consent=$("newsletter-consent");
      if(!base){
        msg.textContent="Newsletter sign-up is temporarily unavailable. Please try again later.";
        msg.className="form-message error";
        return;
      }
      msg.textContent="Saving your email address…";
      msg.className="form-message";
      try{
        const r=await fetch(base+"/api/subscribe",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({email,consent:consent.checked})
        });
        const data=await r.json();
        if(!r.ok)throw new Error(data.error||"Could not save your email address.");
        msg.textContent=data.message||"Your email address has been saved to the India Racing Cycles updates list. Email delivery is not available yet.";
        msg.className="form-message success";
        form.reset();
      }catch(err){
        msg.textContent=err.message;
        msg.className="form-message error";
      }
    });
  }
  setTheme();newsletter();const page=document.body.dataset.page;if(page==="upcoming")initUpcoming();if(page==="past")initPast();if(page==="news")initNews();if(page==="suggestion")suggestionForm();
})();