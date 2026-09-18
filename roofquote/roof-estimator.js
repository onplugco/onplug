(function () {
  const MAPBOX_TOKEN = "pk.eyJ1Ijoia2lyc3RlbjRwaCIsImEiOiJjbXNycjEza3IwM2FtMnhwdXF0bHBia2F3In0.ISKQxJvpQZAOvnmLXs-6eQ";
  const WEB3FORMS_ACCESS_KEY = "37406cf0-5218-4c4e-84ba-8230b8609588";

  function submitQuoteLead(tierName, total, monthly, surfaceSqFt) {
    const payload = {
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: "New Demo Roof Quote Request - " + (state.address || "Unknown address"),
      from_name: "OnPlug - Roof Quote Demo Tool",
      name: (state.contact && state.contact.name) || "",
      email: (state.contact && state.contact.email) || "",
      phone: (state.contact && state.contact.phone) || "",
      address: state.address || "",
      roof_size_sqft: surfaceSqFt,
      selected_package: tierName,
      estimated_total: "$" + Number(total).toLocaleString(),
      estimated_monthly: "$" + Number(monthly).toLocaleString() + "/mo",
      message: "Demo lead submitted via the OnPlug instant roof quote tool."
    };

    return fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json();
      })
      .catch(function (err) {
        console.error("Quote lead submission failed:", err);
        return { success: false };
      });
  }

  const PRICING = {
    tiers: {
      good: {
        name: "Standard",
        material: "3-Tab Asphalt Shingle",
        costPerSqFt: 4.75,
        baseFee: 850,
        features: [
          "25-Year manufacturer warranty",
          "Standard color selection",
          "2-3 day install window"
        ]
      },
      better: {
        name: "Most Popular",
        material: "Architectural Designer Shingle",
        costPerSqFt: 6.25,
        baseFee: 950,
        features: [
          "Lifetime limited warranty",
          "Premium color & style selection",
          "Enhanced wind & impact rating",
          "2-3 day install window"
        ]
      },
      best: {
        name: "Premium",
        material: "Standing Seam Metal Roof",
        costPerSqFt: 9.5,
        baseFee: 1200,
        features: [
          "50-year material warranty",
          "Lifetime workmanship guarantee",
          "Best energy efficiency & longevity",
          "3-5 day install window"
        ]
      }
    }
  };

  const PITCH_OPTIONS = [
    { key: "flat", title: "Flat / Low", desc: "Barely visible slope", mult: 1.0 },
    { key: "low", title: "Low Slope", desc: "Gentle, walkable", mult: 1.05 },
    { key: "moderate", title: "Moderate", desc: "Most common on homes", mult: 1.12 },
    { key: "steep", title: "Steep", desc: "Noticeable pitch", mult: 1.2 }
  ];

  const FINANCING = { apr: 9.9, termMonths: 180 };

  let state = {
    step: 1,
    lat: null,
    lon: null,
    address: "",
    pitchKey: "moderate",
    totalSqFt: 0,
    contact: {},
    sectionMeta: {}
  };

  let map;
  let draw;
  let suggestTimer;
  let suggestIndex = -1;
  let cachedSuggestions = [];

  if (!window.mapboxgl || !window.MapboxDraw || !window.turf) {
    console.error("Roof estimator dependencies failed to load.");
    return;
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  const drawStyles = [
    {
      id: "gl-draw-polygon-fill",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
      paint: { "fill-color": "#D4FF00", "fill-opacity": 0.22 }
    },
    {
      id: "gl-draw-polygon-fill-static",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
      paint: { "fill-color": "#E8FF66", "fill-opacity": 0.15 }
    },
    {
      id: "gl-draw-polygon-stroke-active",
      type: "line",
      filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
      paint: { "line-color": "#E8FF66", "line-width": 2.5 }
    },
    {
      id: "gl-draw-polygon-stroke-inactive",
      type: "line",
      filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
      paint: { "line-color": "#D4FF00", "line-width": 2.5 }
    },
    {
      id: "gl-draw-polygon-and-line-vertex-active",
      type: "circle",
      filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
      paint: { "circle-radius": 5, "circle-color": "#E8FF66" }
    },
    {
      id: "gl-draw-polygon-and-line-vertex-inactive",
      type: "circle",
      filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "active", "true"]],
      paint: { "circle-radius": 4, "circle-color": "#D4FF00" }
    }
  ];

  function goToStep(n) {
    state.step = n;
    document.querySelectorAll("#psr-roof-estimator .psr-step-view").forEach(function (el) {
      el.classList.toggle("active", +el.dataset.step === n);
    });
    document.querySelectorAll("#psrProgressBar .psr-step").forEach(function (el) {
      const s = +el.dataset.step;
      el.classList.toggle("active", s === n);
      el.classList.toggle("done", s < n);
    });
    if (n === 2 && map) {
      setTimeout(function () {
        map.resize();
      }, 120);
    }
  }

  function sqFtFromFeature(feature) {
    return Math.round(turf.area(feature) * 10.7639);
  }

  function initMap() {
    if (map) return;
    map = new mapboxgl.Map({
      container: "psr-map",
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-98.5795, 39.8283],
      zoom: 3.5,
      pitch: 0
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: "simple_select",
      styles: drawStyles
    });
    map.addControl(draw);

    map.on("draw.create", onDrawChange);
    map.on("draw.update", onDrawChange);
    map.on("draw.delete", onDrawChange);
    map.on("draw.selectionchange", onDrawChange);
  }

  function onDrawChange() {
    syncSectionMeta();
    updateSectionUI();
  }

  function syncSectionMeta() {
    const features = draw.getAll().features;
    const ids = new Set(features.map(function (f) {
      return f.id;
    }));
    Object.keys(state.sectionMeta).forEach(function (id) {
      if (!ids.has(id)) delete state.sectionMeta[id];
    });
    features.forEach(function (f, i) {
      if (!state.sectionMeta[f.id]) {
        state.sectionMeta[f.id] = { included: true, label: "Section " + (i + 1) };
      }
    });
  }

  function getIncludedSqFt() {
    return draw.getAll().features.reduce(function (sum, f) {
      const meta = state.sectionMeta[f.id];
      if (meta && meta.included !== false) sum += sqFtFromFeature(f);
      return sum;
    }, 0);
  }

  function updateSectionUI() {
    const list = document.getElementById("psrSectionList");
    const features = draw.getAll().features;
    if (!features.length) {
      list.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.45);padding:4px 0;">No roof sections yet — try Re-detect or draw one.</div>';
    } else {
      list.innerHTML = features
        .map(function (f, i) {
          const meta = state.sectionMeta[f.id] || { included: true };
          const area = sqFtFromFeature(f);
          const excluded = meta.included === false;
          return (
            '<div class="psr-section-row' +
            (excluded ? " excluded" : "") +
            '"><input type="checkbox" data-id="' +
            f.id +
            '" ' +
            (meta.included !== false ? "checked" : "") +
            '><span class="name">Section ' +
            (i + 1) +
            '</span><span class="val">' +
            area.toLocaleString() +
            " sf</span></div>"
          );
        })
        .join("");
      list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          state.sectionMeta[cb.dataset.id].included = cb.checked;
          updateSectionUI();
        });
      });
    }
    state.totalSqFt = getIncludedSqFt();
    document.getElementById("psrTotalAreaDisplay").innerHTML =
      state.totalSqFt.toLocaleString() + " <small>sq ft</small>";
    document.getElementById("psrToStep3Btn").disabled = state.totalSqFt <= 0;
  }

  async function geocode(query) {
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(query) +
      ".json?access_token=" +
      MAPBOX_TOKEN +
      "&limit=5&country=US&types=address,place";
    const res = await fetch(url);
    const data = await res.json();
    return data.features || [];
  }

  async function fetchSuggestions(q) {
    if (q.length < 3) return [];
    return geocode(q);
  }

  function renderSuggestions(features) {
    const list = document.getElementById("psrSuggestList");
    if (!features.length) {
      list.classList.remove("show");
      return;
    }
    list.innerHTML = features
      .map(function (f, i) {
        const main = f.text || f.place_name.split(",")[0];
        const rest = f.place_name.replace(main + ", ", "");
        return (
          '<div class="psr-suggest-item' +
          (i === suggestIndex ? " active" : "") +
          '" data-index="' +
          i +
          '"><strong>' +
          main +
          "</strong> " +
          (rest ? "· " + rest : "") +
          "</div>"
        );
      })
      .join("");
    list.classList.add("show");
    list.querySelectorAll(".psr-suggest-item").forEach(function (el) {
      el.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectSuggestion(+el.dataset.index);
      });
    });
  }

  function selectSuggestion(i) {
    const f = cachedSuggestions[i];
    if (!f) return;
    document.getElementById("psrAddressInput").value = f.place_name;
    document.getElementById("psrSuggestList").classList.remove("show");
    state.lon = f.center[0];
    state.lat = f.center[1];
    state.address = f.place_name;
  }

  const addressInput = document.getElementById("psrAddressInput");
  addressInput.addEventListener("input", function () {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async function () {
      cachedSuggestions = await fetchSuggestions(addressInput.value.trim());
      suggestIndex = -1;
      renderSuggestions(cachedSuggestions);
    }, 280);
  });

  addressInput.addEventListener("keydown", function (e) {
    if (!cachedSuggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestIndex = Math.min(suggestIndex + 1, cachedSuggestions.length - 1);
      renderSuggestions(cachedSuggestions);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestIndex = Math.max(suggestIndex - 1, 0);
      renderSuggestions(cachedSuggestions);
    } else if (e.key === "Enter") {
      if (suggestIndex >= 0) selectSuggestion(suggestIndex);
      else document.getElementById("psrFindRoofBtn").click();
    } else if (e.key === "Escape") {
      document.getElementById("psrSuggestList").classList.remove("show");
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#psr-roof-estimator .psr-field")) {
      const suggestList = document.getElementById("psrSuggestList");
      if (suggestList) suggestList.classList.remove("show");
    }
  });

  function polygonsFromGeometry(geometry) {
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
  }

  function polygonToRect(feature) {
    return turf.bboxPolygon(turf.bbox(feature));
  }

  function defaultRoofRect(lon, lat, widthM, heightM) {
    widthM = widthM || 12;
    heightM = heightM || 16;
    const center = turf.point([lon, lat]);
    const north = turf.destination(center, heightM / 2, 0, { units: "meters" });
    const south = turf.destination(center, heightM / 2, 180, { units: "meters" });
    const nw = turf.destination(north, widthM / 2, 270, { units: "meters" });
    const ne = turf.destination(north, widthM / 2, 90, { units: "meters" });
    const se = turf.destination(south, widthM / 2, 90, { units: "meters" });
    const sw = turf.destination(south, widthM / 2, 270, { units: "meters" });
    return turf.polygon([
      [
        nw.geometry.coordinates,
        ne.geometry.coordinates,
        se.geometry.coordinates,
        sw.geometry.coordinates,
        nw.geometry.coordinates
      ]
    ]);
  }

  async function detectBuildingFootprints(lon, lat) {
    const url =
      "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/" +
      lon +
      "," +
      lat +
      ".json?layers=building&access_token=" +
      MAPBOX_TOKEN +
      "&radius=40&limit=12";
    const res = await fetch(url);
    const data = await res.json();
    const features = (data.features || []).filter(function (f) {
      return f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
    });

    if (!features.length) {
      return [defaultRoofRect(lon, lat)];
    }

    const center = turf.point([lon, lat]);
    return features
      .map(function (f) {
        const polys = polygonsFromGeometry(f.geometry);
        const best = polys
          .map(function (coords) {
            return turf.polygon(coords);
          })
          .sort(function (a, b) {
            return turf.area(b) - turf.area(a);
          })[0];
        return best ? polygonToRect(best) : null;
      })
      .filter(function (f) {
        return f && turf.area(f) > 20;
      })
      .sort(function (a, b) {
        return turf.distance(center, turf.centroid(a)) - turf.distance(center, turf.centroid(b));
      })
      .slice(0, 6);
  }

  async function loadRoofsForLocation(lon, lat) {
    initMap();
    state.sectionMeta = {};
    if (draw) draw.deleteAll();

    await new Promise(function (r) {
      requestAnimationFrame(r);
    });
    map.resize();
    map.jumpTo({ center: [lon, lat], zoom: 19 });

    await new Promise(function (resolve) {
      if (map.isStyleLoaded()) resolve();
      else map.once("load", resolve);
    });

    document.getElementById("psrMapBadge").textContent = "Detecting roof outlines…";

    const buildings = await detectBuildingFootprints(lon, lat);
    buildings.forEach(function (b) {
      draw.add(b);
    });

    if (!buildings.length) {
      document.getElementById("psrMapBadge").textContent = "No outline found — click + to draw your roof";
    } else {
      document.getElementById("psrMapBadge").textContent =
        buildings.length + " section" + (buildings.length > 1 ? "s" : "") + " detected · drag corners to adjust";
    }

    syncSectionMeta();
    updateSectionUI();
  }

  document.getElementById("psrFindRoofBtn").addEventListener("click", async function () {
    const q = addressInput.value.trim();
    const err = document.getElementById("psrAddressErr");
    err.classList.remove("show");
    if (!q) {
      err.textContent = "Please enter an address.";
      err.classList.add("show");
      return;
    }

    const btn = document.getElementById("psrFindRoofBtn");
    btn.disabled = true;
    btn.innerHTML = 'Locating <span class="psr-loading-dots"><span></span><span></span><span></span></span>';

    try {
      if (!state.lat || !state.lon || state.address !== q) {
        const features = await geocode(q);
        if (!features.length) throw new Error("no results");
        const feat = features[0];
        state.lon = feat.center[0];
        state.lat = feat.center[1];
        state.address = feat.place_name;
        addressInput.value = feat.place_name;
      }
      goToStep(2);
      await loadRoofsForLocation(state.lon, state.lat);
    } catch (e) {
      err.textContent = "We couldn't find that address — try adding city and state.";
      err.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Find My Roof";
    }
  });

  document.getElementById("psrRedetectBtn").addEventListener("click", function () {
    if (state.lon && state.lat) loadRoofsForLocation(state.lon, state.lat);
  });
  document.getElementById("psrDrawBtn").addEventListener("click", function () {
    draw.changeMode("draw_polygon");
  });
  document.getElementById("psrDeleteBtn").addEventListener("click", function () {
    const sel = draw.getSelectedIds();
    if (sel.length) draw.delete(sel);
    else updateSectionUI();
  });
  document.getElementById("psrBackTo1Btn").addEventListener("click", function () {
    goToStep(1);
  });
  document.getElementById("psrToStep3Btn").addEventListener("click", function () {
    goToStep(3);
  });

  const pitchGrid = document.getElementById("psrPitchGrid");
  PITCH_OPTIONS.forEach(function (p) {
    const div = document.createElement("div");
    div.className = "psr-pitch-card" + (p.key === state.pitchKey ? " selected" : "");
    div.innerHTML = '<div class="title">' + p.title + '</div><div class="desc">' + p.desc + "</div>";
    div.addEventListener("click", function () {
      state.pitchKey = p.key;
      pitchGrid.querySelectorAll(".psr-pitch-card").forEach(function (c) {
        c.classList.remove("selected");
      });
      div.classList.add("selected");
    });
    pitchGrid.appendChild(div);
  });

  document.getElementById("psrBackTo2Btn").addEventListener("click", function () {
    goToStep(2);
  });
  document.getElementById("psrToStep4Btn").addEventListener("click", function () {
    const name = document.getElementById("psrNameInput").value.trim();
    const email = document.getElementById("psrEmailInput").value.trim();
    const phone = document.getElementById("psrPhoneInput").value.trim();
    const err = document.getElementById("psrContactErr");
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone) {
      err.classList.add("show");
      return;
    }
    err.classList.remove("show");
    state.contact = { name: name, email: email, phone: phone };
    renderQuote();
    goToStep(4);
  });

  function estimateMonthly(principal, aprPct, termMonths) {
    const r = aprPct / 100 / 12;
    return r === 0 ? principal / termMonths : (principal * r) / (1 - Math.pow(1 + r, -termMonths));
  }

  function renderQuote() {
    document.getElementById("psrQuoteAddress").textContent = state.address;
    const pitchMult = PITCH_OPTIONS.find(function (p) {
      return p.key === state.pitchKey;
    }).mult;
    const surfaceSqFt = Math.round(state.totalSqFt * pitchMult);
    const container = document.getElementById("psrTiersContainer");
    container.style.display = "grid";
    document.getElementById("psrConfirmScreen").style.display = "none";

    container.innerHTML = ["good", "better", "best"]
      .map(function (key) {
        const cfg = PRICING.tiers[key];
        const total = Math.round((surfaceSqFt * cfg.costPerSqFt + cfg.baseFee) / 50) * 50;
        const monthly = Math.round(estimateMonthly(total, FINANCING.apr, FINANCING.termMonths));
        const featured = key === "better";
        return (
          '<div class="psr-tier' +
          (featured ? " featured" : "") +
          '">' +
          (featured ? '<div class="badge">Most Popular</div>' : "") +
          '<div class="tier-name">' +
          cfg.name +
          '</div><div class="tier-material">' +
          cfg.material +
          '</div><div class="tier-price">$' +
          total.toLocaleString() +
          '<sup> total</sup></div><div class="tier-monthly">as low as $' +
          monthly.toLocaleString() +
          "/mo w/ financing</div><ul>" +
          cfg.features
            .map(function (f) {
              return "<li>" + f + "</li>";
            })
            .join("") +
          '</ul><button class="psr-btn ' +
          (featured ? "psr-btn-primary" : "psr-btn-ghost") +
          ' psr-btn-block psrSelectTierBtn" type="button" data-tier="' +
          cfg.name +
          '" data-total="' +
          total +
          '" data-monthly="' +
          monthly +
          '">Request This Quote</button></div>'
        );
      })
      .join("");

    container.querySelectorAll(".psrSelectTierBtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const tierName = btn.dataset.tier;
        const total = btn.dataset.total;
        const monthly = btn.dataset.monthly;
        container.style.display = "none";
        document.getElementById("psrConfirmScreen").style.display = "block";
        submitQuoteLead(tierName, total, monthly, surfaceSqFt);
      });
    });
  }

  document.getElementById("psrStartOverBtn").addEventListener("click", function () {
    state = {
      step: 1,
      lat: null,
      lon: null,
      address: "",
      pitchKey: "moderate",
      totalSqFt: 0,
      contact: {},
      sectionMeta: {}
    };
    if (draw) draw.deleteAll();
    addressInput.value = "";
    document.getElementById("psrNameInput").value = "";
    document.getElementById("psrEmailInput").value = "";
    document.getElementById("psrPhoneInput").value = "";
    pitchGrid.querySelectorAll(".psr-pitch-card").forEach(function (c) {
      c.classList.toggle("selected", c.textContent.indexOf("Moderate") >= 0);
    });
    goToStep(1);
  });
})();
