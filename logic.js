// --- STATE MANAGEMENT ---
let MasterStore = { validBINs: new Set(), validORs: new Set() };

// Business Natures reference (from Business Natures.xlsx → data/business-natures.js)
const BusinessLineStore = { byCode: new Map(), list: [] };
function buildBusinessLineIndex(list) {
  BusinessLineStore.byCode = new Map();
  (list || []).forEach(item => {
    if (!item || item.lineCode == null || item.lineCode === '') return;
    let code = String(item.lineCode).trim();
    let prev = BusinessLineStore.byCode.get(code);
    if (!prev || (item.isActive && !prev.isActive)) {
      BusinessLineStore.byCode.set(code, {
        description: item.businessLine || '',
        nature: item.businessNature || '',
        isActive: !!item.isActive
      });
    }
  });
  BusinessLineStore.list = [];
  BusinessLineStore.byCode.forEach((v, code) => {
    BusinessLineStore.list.push({
      code,
      description: v.description,
      nature: v.nature,
      isActive: v.isActive
    });
  });
  BusinessLineStore.list.sort((a, b) => a.code.localeCompare(b.code));
}
function normalizeLineCode(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/^['"]+|['"]+$/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s) && s.length < 5) s = s.padStart(5, '0');
  return s;
}
function lookupBusinessLine(raw) {
  let code = normalizeLineCode(raw);
  if (!code) return null;
  return BusinessLineStore.byCode.get(code) || null;
}
function searchBusinessLines(query, limit) {
  let q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  let max = limit || 20;
  let codeQ = /^\d+$/.test(q) ? (q.length < 5 ? q.padStart(5, '0') : q) : q;
  let scored = [];
  for (let i = 0; i < BusinessLineStore.list.length; i++) {
    let item = BusinessLineStore.list[i];
    let code = item.code.toLowerCase();
    let desc = (item.description || '').toLowerCase();
    let score = 0;
    if (code === codeQ || code === q) score = 100;
    else if (code.startsWith(q) || code.startsWith(codeQ)) score = 80;
    else if (code.includes(q) || code.includes(codeQ)) score = 60;
    else if (desc.includes(q)) score = 40;
    else continue;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code));
  return scored.slice(0, max).map(s => s.item);
}
buildBusinessLineIndex(typeof BUSINESS_NATURES !== 'undefined' ? BUSINESS_NATURES : []);

let auditLog = []; // { table, row, type, message }

let appState = {
    table1: { loaded: false, headers: [], rows: [], cellErrors: {}, autocorrectedCells: {}, hasValidated: false },
    table2: { loaded: false, headers: [], rows: [], cellErrors: {}, autocorrectedCells: {}, hasValidated: false },
    table3: { loaded: false, headers: [], rows: [], cellErrors: {}, autocorrectedCells: {}, hasValidated: false },
    table4: { loaded: false, headers: [], rows: [], cellErrors: {}, autocorrectedCells: {}, hasValidated: false }
};

let activeTableId = 'table1';
let currentPage = 1;
const rowsPerPage = 100;
let pendingDuplicates = []; // Array of { table, key, rowIndices }
let selectedLGU = null; // { province, municipality, psgcPrefix }

// ── REGION 2 PSGC DATABASE ──
// BIN PSGC format: '0' + '20'(Region2) + 2-digit-province + 2-digit-municipality
// Formula: psgcPrefix = '0' + '20' + provinceCode + municipalityCode
const REGION2_LGUS = {
    "batanes": {
        "label": "Batanes",
        "code": "09",
        "municipalities": [
            {
                "name": "Basco",
                "code": "01",
                "psgc7": "0200901"
            },
            {
                "name": "Itbayat",
                "code": "02",
                "psgc7": "0200902"
            },
            {
                "name": "Ivana",
                "code": "03",
                "psgc7": "0200903"
            },
            {
                "name": "Mahatao",
                "code": "04",
                "psgc7": "0200904"
            },
            {
                "name": "Sabtang",
                "code": "05",
                "psgc7": "0200905"
            },
            {
                "name": "Uyugan",
                "code": "06",
                "psgc7": "0200906"
            }
        ]
    },
    "cagayan": {
        "label": "Cagayan",
        "code": "15",
        "municipalities": [
            {
                "name": "Abulug",
                "code": "01",
                "psgc7": "0201501"
            },
            {
                "name": "Alcala",
                "code": "02",
                "psgc7": "0201502"
            },
            {
                "name": "Allacapan",
                "code": "03",
                "psgc7": "0201503"
            },
            {
                "name": "Amulung",
                "code": "04",
                "psgc7": "0201504"
            },
            {
                "name": "Aparri",
                "code": "05",
                "psgc7": "0201505"
            },
            {
                "name": "Baggao",
                "code": "06",
                "psgc7": "0201506"
            },
            {
                "name": "Ballesteros",
                "code": "07",
                "psgc7": "0201507"
            },
            {
                "name": "Buguey",
                "code": "08",
                "psgc7": "0201508"
            },
            {
                "name": "Calayan",
                "code": "09",
                "psgc7": "0201509"
            },
            {
                "name": "Camalaniugan",
                "code": "10",
                "psgc7": "0201510"
            },
            {
                "name": "Claveria",
                "code": "11",
                "psgc7": "0201511"
            },
            {
                "name": "Enrile",
                "code": "12",
                "psgc7": "0201512"
            },
            {
                "name": "Gattaran",
                "code": "13",
                "psgc7": "0201513"
            },
            {
                "name": "Gonzaga",
                "code": "14",
                "psgc7": "0201514"
            },
            {
                "name": "Iguig",
                "code": "15",
                "psgc7": "0201515"
            },
            {
                "name": "Lal-lo",
                "code": "16",
                "psgc7": "0201516"
            },
            {
                "name": "Lasam",
                "code": "17",
                "psgc7": "0201517"
            },
            {
                "name": "Pamplona",
                "code": "18",
                "psgc7": "0201518"
            },
            {
                "name": "Peñablanca",
                "code": "19",
                "psgc7": "0201519"
            },
            {
                "name": "Piat",
                "code": "20",
                "psgc7": "0201520"
            },
            {
                "name": "Rizal",
                "code": "21",
                "psgc7": "0201521"
            },
            {
                "name": "Sanchez-Mira",
                "code": "22",
                "psgc7": "0201522"
            },
            {
                "name": "Santa Ana",
                "code": "23",
                "psgc7": "0201523"
            },
            {
                "name": "Santa Praxedes",
                "code": "24",
                "psgc7": "0201524"
            },
            {
                "name": "Santa Teresita",
                "code": "25",
                "psgc7": "0201525"
            },
            {
                "name": "Santo Niño",
                "code": "26",
                "psgc7": "0201526"
            },
            {
                "name": "Solana",
                "code": "27",
                "psgc7": "0201527"
            },
            {
                "name": "Tuao",
                "code": "28",
                "psgc7": "0201528"
            },
            {
                "name": "Tuguegarao City",
                "code": "29",
                "psgc7": "0201529"
            }
        ]
    },
    "isabela": {
        "label": "Isabela",
        "code": "31",
        "municipalities": [
            {
                "name": "Alicia",
                "code": "01",
                "psgc7": "0203101"
            },
            {
                "name": "Angadanan",
                "code": "02",
                "psgc7": "0203102"
            },
            {
                "name": "Aurora",
                "code": "03",
                "psgc7": "0203103"
            },
            {
                "name": "Benito Soliven",
                "code": "04",
                "psgc7": "0203104"
            },
            {
                "name": "Burgos",
                "code": "05",
                "psgc7": "0203105"
            },
            {
                "name": "Cabagan",
                "code": "06",
                "psgc7": "0203106"
            },
            {
                "name": "Cabatuan",
                "code": "07",
                "psgc7": "0203107"
            },
            {
                "name": "Cauayan City",
                "code": "08",
                "psgc7": "0203108"
            },
            {
                "name": "Cordon",
                "code": "09",
                "psgc7": "0203109"
            },
            {
                "name": "Dinapigue",
                "code": "10",
                "psgc7": "0203110"
            },
            {
                "name": "Divilacan",
                "code": "11",
                "psgc7": "0203111"
            },
            {
                "name": "Echague",
                "code": "12",
                "psgc7": "0203112"
            },
            {
                "name": "Gamu",
                "code": "13",
                "psgc7": "0203113"
            },
            {
                "name": "Ilagan City",
                "code": "14",
                "psgc7": "0203114"
            },
            {
                "name": "Jones",
                "code": "15",
                "psgc7": "0203115"
            },
            {
                "name": "Luna",
                "code": "16",
                "psgc7": "0203116"
            },
            {
                "name": "Maconacon",
                "code": "17",
                "psgc7": "0203117"
            },
            {
                "name": "Delfin Albano",
                "code": "18",
                "psgc7": "0203118"
            },
            {
                "name": "Mallig",
                "code": "19",
                "psgc7": "0203119"
            },
            {
                "name": "Naguilian",
                "code": "20",
                "psgc7": "0203120"
            },
            {
                "name": "Palanan",
                "code": "21",
                "psgc7": "0203121"
            },
            {
                "name": "Quezon",
                "code": "22",
                "psgc7": "0203122"
            },
            {
                "name": "Quirino",
                "code": "23",
                "psgc7": "0203123"
            },
            {
                "name": "Ramon",
                "code": "24",
                "psgc7": "0203124"
            },
            {
                "name": "Reina Mercedes",
                "code": "25",
                "psgc7": "0203125"
            },
            {
                "name": "Roxas",
                "code": "26",
                "psgc7": "0203126"
            },
            {
                "name": "San Agustin",
                "code": "27",
                "psgc7": "0203127"
            },
            {
                "name": "San Guillermo",
                "code": "28",
                "psgc7": "0203128"
            },
            {
                "name": "San Isidro",
                "code": "29",
                "psgc7": "0203129"
            },
            {
                "name": "San Manuel",
                "code": "30",
                "psgc7": "0203130"
            },
            {
                "name": "San Mariano",
                "code": "31",
                "psgc7": "0203131"
            },
            {
                "name": "San Mateo",
                "code": "32",
                "psgc7": "0203132"
            },
            {
                "name": "San Pablo",
                "code": "33",
                "psgc7": "0203133"
            },
            {
                "name": "Santa Maria",
                "code": "34",
                "psgc7": "0203134"
            },
            {
                "name": "Santiago City",
                "code": "35",
                "psgc7": "0203135"
            },
            {
                "name": "Santo Tomas",
                "code": "36",
                "psgc7": "0203136"
            },
            {
                "name": "Tumauini",
                "code": "37",
                "psgc7": "0203137"
            }
        ]
    },
    "nueva_vizcaya": {
        "label": "Nueva Vizcaya",
        "code": "50",
        "municipalities": [
            {
                "name": "Ambaguio",
                "code": "01",
                "psgc7": "0205001"
            },
            {
                "name": "Aritao",
                "code": "02",
                "psgc7": "0205002"
            },
            {
                "name": "Bagabag",
                "code": "03",
                "psgc7": "0205003"
            },
            {
                "name": "Bambang",
                "code": "04",
                "psgc7": "0205004"
            },
            {
                "name": "Bayombong",
                "code": "05",
                "psgc7": "0205005"
            },
            {
                "name": "Diadi",
                "code": "06",
                "psgc7": "0205006"
            },
            {
                "name": "Dupax del Norte",
                "code": "07",
                "psgc7": "0205007"
            },
            {
                "name": "Dupax del Sur",
                "code": "08",
                "psgc7": "0205008"
            },
            {
                "name": "Kasibu",
                "code": "09",
                "psgc7": "0205009"
            },
            {
                "name": "Kayapa",
                "code": "10",
                "psgc7": "0205010"
            },
            {
                "name": "Alfonso Castañeda",
                "code": "11",
                "psgc7": "0205011"
            },
            {
                "name": "Santa Fe",
                "code": "12",
                "psgc7": "0205012"
            },
            {
                "name": "Solano",
                "code": "13",
                "psgc7": "0205013"
            },
            {
                "name": "Villaverde",
                "code": "14",
                "psgc7": "0205014"
            },
            {
                "name": "Quezon",
                "code": "15",
                "psgc7": "0205015"
            }
        ]
    },
    "quirino": {
        "label": "Quirino",
        "code": "57",
        "municipalities": [
            {
                "name": "Aglipay",
                "code": "01",
                "psgc7": "0205701"
            },
            {
                "name": "Cabarroguis",
                "code": "02",
                "psgc7": "0205702"
            },
            {
                "name": "Diffun",
                "code": "03",
                "psgc7": "0205703"
            },
            {
                "name": "Maddela",
                "code": "04",
                "psgc7": "0205704"
            },
            {
                "name": "Saguday",
                "code": "05",
                "psgc7": "0205705"
            },
            {
                "name": "Nagtipunan",
                "code": "06",
                "psgc7": "0205706"
            }
        ]
    }
};

function computePSGCPrefix(provinceKey, municipalityCode) {
    if (!provinceKey || !municipalityCode) return null;
    let prov = REGION2_LGUS[provinceKey];
    if (!prov) return null;
    let muni = prov.municipalities.find(m => m.code === municipalityCode);
    if (!muni) return null;
    return muni.psgc7;
}




// ── INPUT MASK HELPERS ──
// TIN format: 000-000-000-00000  (3-3-3-5 digits, max 17 chars)
function applyTINMask(val) {
    let d = val.replace(/\D/g, '').substring(0, 14);
    let out = d.substring(0, 3);
    if (d.length > 3)  out += '-' + d.substring(3, 6);
    if (d.length > 6)  out += '-' + d.substring(6, 9);
    if (d.length > 9)  out += '-' + d.substring(9, 14);
    return out;
}
// PIN format: 000-00-000-00-000  (3-2-3-2-3 digits, max 17 chars)
function applyPINMask(val) {
    let d = val.replace(/\D/g, '').substring(0, 13);
    let out = d.substring(0, 3);
    if (d.length > 3)  out += '-' + d.substring(3, 5);
    if (d.length > 5)  out += '-' + d.substring(5, 8);
    if (d.length > 8)  out += '-' + d.substring(8, 10);
    if (d.length > 10) out += '-' + d.substring(10, 13);
    return out;
}


// Dark mode logic
let isDark = false;
document.getElementById('themeBtn').addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('themeBtn').innerText = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
});

// ── LGU SELECTOR LOGIC ──
document.getElementById('provinceSelect').addEventListener('change', function() {
    let provKey = this.value;
    let muniSel = document.getElementById('municipalitySelect');
    muniSel.innerHTML = '<option value="">-- Select Municipality --</option>';
    muniSel.disabled = !provKey;
    document.getElementById('psgcDisplay').style.display = 'none';
    document.getElementById('lguClearBtn').style.display = 'none';
    selectedLGU = null;

    if (provKey && REGION2_LGUS[provKey]) {
        REGION2_LGUS[provKey].municipalities.forEach(m => {
            let opt = document.createElement('option');
            opt.value = m.code;
            opt.textContent = m.name;
            muniSel.appendChild(opt);
        });
    }
});

document.getElementById('municipalitySelect').addEventListener('change', function() {
    let muniCode = this.value;
    let provKey  = document.getElementById('provinceSelect').value;
    if (!muniCode || !provKey) { selectedLGU = null; return; }

    let psgcPrefix = computePSGCPrefix(provKey, muniCode);
    let muniName   = REGION2_LGUS[provKey].municipalities.find(m => m.code === muniCode)?.name || '';
    let provLabel  = REGION2_LGUS[provKey].label;

    selectedLGU = { province: provKey, provinceLabel: provLabel, municipality: muniName, muniCode, psgcPrefix };

    // Show PSGC badge
    let badge = document.getElementById('psgcBadge');
    badge.textContent = psgcPrefix;
    let disp = document.getElementById('psgcDisplay');
    disp.style.display = 'flex';
    disp.style.alignItems = 'center';
    disp.style.gap = '8px';
    document.getElementById('lguClearBtn').style.display = 'inline';

    // Show confirmation toast
    document.getElementById('status').textContent =
        `✅ LGU set: ${muniName}, ${provLabel} — BIN must start with ${psgcPrefix}`;
    document.getElementById('status').className = 'status-success';
});

document.getElementById('lguClearBtn').addEventListener('click', () => {
    document.getElementById('provinceSelect').value = '';
    document.getElementById('municipalitySelect').innerHTML = '<option value="">-- Select Municipality --</option>';
    document.getElementById('municipalitySelect').disabled = true;
    document.getElementById('psgcDisplay').style.display = 'none';
    document.getElementById('lguClearBtn').style.display = 'none';
    selectedLGU = null;
    document.getElementById('status').textContent = 'LGU selection cleared.';
    document.getElementById('status').className = 'status-info';
});

document.getElementById('csvFile').addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files.length) return;
    
    let filesProcessed = 0;
    
    Array.from(files).forEach(file => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                let headers = results.meta.fields || [];
                let detectedId = detectTableType(headers);
                
                // ── HEADER NORMALIZATION ── Fix common CSV column name typos
                const HEADER_ALIASES = {
                    'dti_registratrion_expiry_date': 'dti_registration_expiry_date',
                    'dti_registration_expiry': 'dti_registration_expiry_date',
                    'dti_expiry_date': 'dti_registration_expiry_date',
                    'dti_expiry': 'dti_registration_expiry_date'
                };
                let headerMap = {};
                headers.forEach(h => {
                    let normalized = HEADER_ALIASES[h.trim().toLowerCase()] || h.trim();
                    headerMap[h] = normalized;
                });
                let normalizedHeaders = headers.map(h => headerMap[h]);
                
                // Remap row keys if any header was aliased
                let normalizedRows = results.data.map(row => {
                    let newRow = {};
                    Object.keys(row).forEach(k => {
                        newRow[headerMap[k] || k] = row[k];
                    });
                    return newRow;
                });
                
                appState[detectedId] = {
                    loaded: true,
                    headers: normalizedHeaders,
                    rows: normalizedRows,
                    cellErrors: {},
                    autocorrectedCells: {},
                    hasValidated: false
                };
                
                let tab = document.querySelector(`.tab[data-target="${detectedId}"]`);
                if(tab) tab.classList.remove('disabled');
                
                auditLog.push({table: detectedId, row: 'System', type: 'INFO', message: `Loaded ${results.data.length} rows.`});
                
                filesProcessed++;
                if (filesProcessed === files.length) {
                    // All files loaded. Auto-switch to table1 if loaded, or the first loaded.
                    if (appState['table1'].loaded) switchTab('table1');
                    else switchTab(detectedId);
                    
                    document.getElementById('validateBtn').disabled = false;
                    document.getElementById('autocorrectBtn').disabled = false;
                }
            }
        });
    });
});

document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
        if (!t.classList.contains('disabled')) {
            switchTab(t.dataset.target);
        }
    });
});

function switchTab(tableId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    let tab = document.querySelector(`.tab[data-target="${tableId}"]`);
    if(tab) tab.classList.add('active');
    activeTableId = tableId;
    currentPage = 1;
    
    document.getElementById('tableBadge').textContent = 'Mode: ' + activeTableId.toUpperCase();
    document.getElementById('tableBadge').style.display = 'inline-block';
    
    let st = appState[activeTableId];
    document.getElementById('exportBtn').style.display = st.hasValidated ? 'inline-flex' : 'none';
    document.getElementById('exportAuditBtn').style.display = auditLog.length > 0 ? 'inline-flex' : 'none';
    
    renderTable();
    updateStatusUI();
}

function detectTableType(csvHeaders) {
  let joined = csvHeaders.join(',').toLowerCase();
  if (joined.includes('dti_no') || joined.includes('business_type')) return 'table1';
  if (joined.includes('business_line_code')) return 'table2';
  if (joined.includes('application_type')) return 'table3';
  if (joined.includes('application_or_no') || joined.includes('fee_code') || joined.includes('type')) return 'table4';
  return 'table1'; 
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderTable() {
    const c = document.getElementById('tableContainer');
    let st = appState[activeTableId];
    if (!st || !st.loaded) {
        c.innerHTML = '';
        document.getElementById('paginationBar').style.display = 'none';
        return;
    }

    let schema = schemas[activeTableId];
    // Force the headers to strictly match the Schema, stripping out any garbage columns from the raw CSV
    st.headers = [...schema.FIELD_ORDER];
    let orderedHeaders = st.headers;

    let totalRows = st.rows.length;
    let totalPages = Math.ceil(totalRows / rowsPerPage);
    if(currentPage > totalPages) currentPage = totalPages || 1;
    
    let startIdx = (currentPage - 1) * rowsPerPage;
    let endIdx = Math.min(startIdx + rowsPerPage, totalRows);
    
    let html = '<div class="table-wrap"><table><thead><tr><th class="row-num">#</th>';
    orderedHeaders.forEach(h => {
        let rule = schema.RULES[h];
        let badge = rule && rule.required ? '<span style="color:#ef4444">*</span>' : (!rule ? '' : '<span style="color:#94a3b8;font-size:10px">opt</span>');
        html += `<th>${rule?.label || h} ${badge}</th>`;
    });
    html += '</tr></thead><tbody>';

    const dateFields = schema.DATE_FIELDS || [];

    for (let rIdx = startIdx; rIdx < endIdx; rIdx++) {
        let row = st.rows[rIdx];
        let hasErr = st.cellErrors[rIdx] && Object.keys(st.cellErrors[rIdx]).length > 0;
        html += `<tr class="${hasErr ? 'has-error' : ''}"><td class="row-num">${rIdx+1}</td>`;
        orderedHeaders.forEach(key => {
            let err = st.cellErrors[rIdx]?.[key];
            let isAuto = st.autocorrectedCells[rIdx] && st.autocorrectedCells[rIdx].has(key);
            let cls = 'cell-input';
            if (err) cls += ' cell-err';
            else if (isAuto && st.hasValidated) cls += ' cell-autocorrected';
            else if (st.hasValidated) cls += ' cell-ok';
            let displayVal = row[key] || '';
            let rule = schema.RULES[key] || {};
            
            let cellHtml = '';

            if (rule.allowed && rule.allowed.length > 0) {
                // ── DROPDOWN SELECT ──
                let opts = `<option value=""></option>`;
                rule.allowed.forEach(a => {
                    opts += `<option value="${a}" ${displayVal === a ? 'selected' : ''}>${a}</option>`;
                });
                cellHtml = `<select class="${cls}" data-row="${rIdx}" data-col="${key}">${opts}</select>`;
            } else if (dateFields.includes(key)) {
                // ── DATE PICKER ── Convert MM/DD/YYYY to YYYY-MM-DD for the input, display back
                let dateVal = '';
                let clean = String(displayVal).replace(/^'+/, '').trim();
                let dObj = new Date(clean);
                if (!isNaN(dObj.getTime())) {
                    let m = String(dObj.getMonth() + 1).padStart(2, '0');
                    let d = String(dObj.getDate()).padStart(2, '0');
                    let y = dObj.getFullYear();
                    dateVal = `${y}-${m}-${d}`;
                }
                cellHtml = `<input type="date" class="${cls}" data-row="${rIdx}" data-col="${key}" value="${dateVal}">`;
            } else {
                // ── MASKED TEXT INPUT ──
                let maxLen = rule.max || '';
                if (key === 'cellphone_no') maxLen = '13';
                if (key === 'tin_no') maxLen = '17';     // 000-000-000-00000
                if (key === 'pin_no') maxLen = '17';     // 000-00-000-00-000
                if (key === 'tdn_no') maxLen = '20';     // alphanumeric, free format
                if (key === 'bin' || key === 'business_bin') maxLen = '20'; // 7-4-7 + 2 dashes
                if (rule.numeric && !maxLen) maxLen = '20';
                let htmlAttr = maxLen ? ` maxlength="${maxLen}"` : '';
                cellHtml = `<input type="text" class="${cls}" data-row="${rIdx}" data-col="${key}" value="${escapeHtml(displayVal)}"${htmlAttr}>`;
            }
            let cellTitle = err || '';
            if (key === 'business_line_code') {
                let hit = lookupBusinessLine(displayVal);
                if (hit && hit.description) {
                    cellTitle = (cellTitle ? cellTitle + '\n\n' : '') + hit.description;
                }
            }
            html += `<td title="${escapeHtml(cellTitle)}">${cellHtml}</td>`;
        });
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    c.innerHTML = html;
    
    // Pagination UI
    let pBar = document.getElementById('paginationBar');
    if (totalRows > rowsPerPage) {
        pBar.style.display = 'flex';
        document.getElementById('pageInfo').innerText = `Page ${currentPage} of ${totalPages} (${startIdx+1}-${endIdx} of ${totalRows})`;
        document.getElementById('prevPage').disabled = currentPage === 1;
        document.getElementById('nextPage').disabled = currentPage === totalPages;
    } else {
        pBar.style.display = 'none';
    }

    // ── TEXT INPUT EVENTS ──
    c.querySelectorAll('input.cell-input').forEach(input => {
        input.addEventListener('input', e => {
            let r = parseInt(e.target.dataset.row), k = e.target.dataset.col;
            let rule = schemas[activeTableId].RULES[k] || {};
            
            // Real-time Input Masking
            if (e.target.type !== 'date') {
                if (rule.numeric) {
                    e.target.value = e.target.value.replace(/[^\d.\-]/g, '');
                } else if (k === 'cellphone_no') {
                    e.target.value = e.target.value.replace(/[^\d']/g, '');
                } else if (k === 'tin_no') {
                    e.target.value = applyTINMask(e.target.value);
                } else if (k === 'pin_no') {
                    e.target.value = applyPINMask(e.target.value);
                } else if (k === 'bin' || k === 'business_bin') {
                    e.target.value = e.target.value.replace(/[^\d\-]/g, '');
                } else if (k === 'tdn_no') {
                    e.target.value = e.target.value.replace(/[^\w\-]/g, '').toUpperCase();
                } else if (k === 'incharge_extension_name') {
                    e.target.value = e.target.value.replace(/\./g, '');
                }
            }

            // Date picker: convert YYYY-MM-DD → 'MM/DD/YYYY
            if (e.target.type === 'date' && e.target.value) {
                let [y,m,d] = e.target.value.split('-');
                st.rows[r][k] = `'${m}/${d}/${y}`;
            } else {
                st.rows[r][k] = e.target.value;
            }
            if (st.hasValidated) runLiveValidation(r, k, e.target);
        });
        input.addEventListener('change', e => {
            // Also handle date on change
            if (e.target.type === 'date' && e.target.value) {
                let r = parseInt(e.target.dataset.row), k = e.target.dataset.col;
                let [y,m,d] = e.target.value.split('-');
                st.rows[r][k] = `'${m}/${d}/${y}`;
            }
            if (st.hasValidated) runLiveValidation(parseInt(e.target.dataset.row), e.target.dataset.col, e.target);
        });
        input.addEventListener('mouseenter', e => showTooltip(e.target));
        input.addEventListener('mouseleave', hideTooltip);
    });

    // ── SELECT DROPDOWN EVENTS ──
    c.querySelectorAll('select.cell-input').forEach(sel => {
        sel.addEventListener('change', e => {
            let r = parseInt(e.target.dataset.row), k = e.target.dataset.col;
            st.rows[r][k] = e.target.value;
            if (st.hasValidated) runLiveValidation(r, k, e.target);
        });
        sel.addEventListener('mouseenter', e => showTooltip(e.target));
        sel.addEventListener('mouseleave', hideTooltip);
    });
}


document.getElementById('prevPage').addEventListener('click', () => { if(currentPage > 1) { currentPage--; renderTable(); }});
document.getElementById('nextPage').addEventListener('click', () => { 
    let max = Math.ceil(appState[activeTableId].rows.length / rowsPerPage);
    if(currentPage < max) { currentPage++; renderTable(); }
});

const tipEl = document.getElementById('customTooltip');
function showTooltip(input) {
  let r = input.dataset.row;
  let k = input.dataset.col;
  let st = appState[activeTableId];
  let err = st.cellErrors[r]?.[k];
  let html = '';

  if (err) {
    html += `<div class="err">⚠️ ${escapeHtml(err)}</div>`;
    let hint = schemas[activeTableId].HINTS[k];
    if (hint) {
      if (hint.rule) html += `<div class="rule">${escapeHtml(hint.rule)}</div>`;
      if (hint.fix) html += `<div class="hint">Fix: ${escapeHtml(hint.fix)}</div>`;
    }
  }

  // Table 2: show matched Business Natures description on hover
  if (k === 'business_line_code') {
    let val = st.rows[r]?.[k];
    let hit = lookupBusinessLine(val);
    if (hit && hit.description) {
      html += `<div class="desc-label">Business Line</div>`;
      html += `<div class="desc">${escapeHtml(hit.description)}</div>`;
      if (hit.nature) html += `<div class="rule">${escapeHtml(hit.nature)}</div>`;
    }
  }

  if (!html) return;
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  let rect = input.getBoundingClientRect();
  tipEl.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
  tipEl.style.top = (rect.bottom + 5) + 'px';
}
function hideTooltip() { tipEl.style.display = 'none'; }

function parseRobustDate(val) {
    if (!val) return null;
    let clean = String(val).replace(/^'+/, '').trim();
    if (!clean) return null;
    
    let dObj = new Date(clean);
    
    // Excel Serial Date (e.g., 45000)
    if (/^\d{4,5}$/.test(clean)) {
        let serial = parseInt(clean);
        dObj = new Date(Date.UTC(1899, 11, 30 + serial));
    } 
    // DD/MM/YYYY or MM/DD/YYYY
    else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(clean)) {
        let parts = clean.split(/[\/\-]/);
        let p1 = parseInt(parts[0]);
        let p2 = parseInt(parts[1]);
        let y = parseInt(parts[2]);
        if (p1 > 12) {
            dObj = new Date(y, p2 - 1, p1); // DD/MM/YYYY
        } else {
            dObj = new Date(y, p1 - 1, p2); // MM/DD/YYYY
        }
    }
    
    if (isNaN(dObj.getTime())) return null;
    
    let y = dObj.getFullYear();
    if (y < 1900 || y > 2100) return null; // sanity check
    
    return dObj;
}

function formatDate(raw) {
  let dObj = parseRobustDate(raw);
  if (!dObj) return raw;
  let formatted = String(dObj.getMonth()+1).padStart(2,'0') + '/' + String(dObj.getDate()).padStart(2,'0') + '/' + dObj.getFullYear();
  return "'" + formatted;
}

function normalizeBIN(raw) {
    if (!raw) return null;
    let bin = String(raw).trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
    bin = bin.replace(/[–—−]/g, '-').replace(/\s+/g, '');
    if (/^\d{7}-\d{4}-\d{7}$/.test(bin)) return bin;
    return null;
}

function customValidateRow(tableId, row, errs, seenLists) {
    const g = (k) => (row[k] == null ? '' : String(row[k])).trim();
    
    if (tableId === 'table1') {
        let bin = g('bin');
        if (bin) {
            let normBin = normalizeBIN(bin);
            if (!normBin) {
                errs.bin = 'Format: PSGC7-YEAR4-INC7  e.g. 0201514-2025-0000001';
            } else if (selectedLGU) {
                let actualPrefix = normBin.substring(0, 7);
                if (actualPrefix !== selectedLGU.psgcPrefix) {
                    errs.bin = `PSGC mismatch: expected ${selectedLGU.psgcPrefix} (${selectedLGU.municipality}, ${selectedLGU.provinceLabel}), got ${actualPrefix}`;
                }
            }
        }
        
        let cell = g('cellphone_no');
        if (cell && !/^'?639\d{9}$/.test(cell)) errs.cellphone_no = 'Must be 12 digits starting with 639';
        
        let email = g('email_address');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email_address = 'Invalid email format';

        let tin = g('tin_no');
        if (tin && !/^\d{3}-\d{3}-\d{3}-\d{5}$/.test(tin)) errs.tin_no = 'Format: 000-000-000-00000';

        let pin = g('pin_no');
        if (pin && !/^\d{3}-\d{2}-\d{3}-\d{2}-\d{3}$/.test(pin)) errs.pin_no = 'Format: 000-00-000-00-000';

        let ext = g('incharge_extension_name');
        if (ext && ext.includes('.')) errs.incharge_extension_name = 'Do not include period (.)';

        let bt = g('business_type');
        if (bt === 'SOLE PROPRIETORSHIP') {
            if (!g('dti_no')) errs.dti_no = 'Required for SOLE PROPRIETORSHIP';
            if (!g('dti_registration_expiry_date')) errs.dti_registration_expiry_date = 'Required for SOLE PROPRIETORSHIP';
        }
        if (['ONE PERSON CORPORATION','PARTNERSHIP','CORPORATION'].includes(bt) && !g('sec_no')) errs.sec_no = 'Required for ' + bt;
        if (bt === 'COOPERATIVE' && !g('cda_no')) errs.cda_no = 'Required for COOPERATIVE';
        
        let locOwned = g('location_owned');
        if (locOwned === '1') {
            if (!g('tdn_no') && !g('pin_no')) {
                errs.tdn_no = 'Provide TDN or PIN for owned';
                errs.pin_no = 'Provide TDN or PIN for owned';
            }
        }
        if (locOwned === '0') {
            if (!g('lessor_name')) errs.lessor_name = 'Required for rented';
            if (!g('monthly_rental')) errs.monthly_rental = 'Required for rented';
        }

        let floorArea = g('floor_area');
        let areaVal = g('area');
        if (floorArea !== '' && areaVal !== '' && /^\d+(\.\d+)?$/.test(floorArea) && /^\d+(\.\d+)?$/.test(areaVal)) {
            if (Number(areaVal) > Number(floorArea)) {
                errs.area = 'Must not exceed floor_area (' + floorArea + ')';
            }
        }
        
        let male = Number(g('no_of_male_employees') || 0);
        let female = Number(g('no_of_female_employees') || 0);
        let residing = Number(g('no_of_employees_residing_within_the_area') || 0);
        if (residing > male + female) errs.no_of_employees_residing_within_the_area = 'Cannot exceed total (' + (male+female) + ')';
    } 
    else if (tableId === 'table2' || tableId === 'table3' || tableId === 'table4') {
        let binKey = tableId === 'table2' ? 'bin' : 'business_bin';
        let bin = g(binKey);
        if (bin) {
            let normBin = normalizeBIN(bin);
            if (!normBin) {
                errs[binKey] = 'Format: PSGC7-YEAR4-INC7  e.g. 0201514-2025-0000001';
            } else if (selectedLGU) {
                let actualPrefix = normBin.substring(0, 7);
                if (actualPrefix !== selectedLGU.psgcPrefix) {
                    errs[binKey] = `PSGC mismatch: expected ${selectedLGU.psgcPrefix} (${selectedLGU.municipality})  got ${actualPrefix}`;
                }
            }
        }
        
        // CROSS-TABLE: BIN → Business (only when Business is loaded + validated)
        if (appState['table1'].loaded && appState['table1'].hasValidated) {
            let normBin = normalizeBIN(bin);
            if (normBin && !MasterStore.validBINs.has(normBin)) {
                errs[binKey] = 'BIN not found in Business sheet';
            }
        }
    }

    // Table 2: gross_amount = essential + nonessential (guidelines when 50% essential is used)
    // + business_line_code must exist in Business Natures reference
    if (tableId === 'table2') {
        let gross = g('gross_amount');
        let ess = g('gross_amount_essential');
        let non = g('gross_amount_nonessential');
        if (gross !== '' && ess !== '' && non !== '') {
            let gN = Number(String(gross).replace(/[^\d.\-]/g, ''));
            let eN = Number(String(ess).replace(/[^\d.\-]/g, ''));
            let nN = Number(String(non).replace(/[^\d.\-]/g, ''));
            if (!isNaN(gN) && !isNaN(eN) && !isNaN(nN)) {
                let expected = eN + nN;
                if (Math.abs(gN - expected) > 0.01) {
                    errs.gross_amount = 'Must equal Gross Essential + Gross Non-Essential (' + expected + ')';
                }
            }
        }

        let lineCode = g('business_line_code');
        if (lineCode) {
            if (!lookupBusinessLine(lineCode)) {
                errs.business_line_code = 'Code not found in Business Natures reference';
            }
        }
    }

    // CROSS-TABLE: Fee OR → Application (only when Application is loaded + validated)
    if (tableId === 'table4') {
        let orNo = g('application_or_no');
        if (appState['table3'].loaded && appState['table3'].hasValidated) {
            if (orNo && !MasterStore.validORs.has(orNo)) {
                errs.application_or_no = 'OR not found in Application sheet';
            }
        }
    }
    
    if (tableId === 'table3') {
        let appYear = Number(g('year'));
        let bin = g('business_bin');
        let normBin3 = normalizeBIN(bin);

        if (normBin3 && appYear) {
            let binYear = Number(normBin3.split('-')[1]);
            if (appYear <= binYear) {
                errs.year = `Year (${appYear}) must be GREATER than BIN year (${binYear}). e.g. BIN is ${binYear}, so Year must be ${binYear + 1} or later.`;
            }
        }

        let qf = g('qtr_from'), qt = g('qtr_to');
        if (qf && qt && Number(qt) < Number(qf)) errs.qtr_to = 'Must be >= Qtr From';
        
        let issuedVal = g('issued_date');
        let validVal = g('valid_until');
        if (issuedVal && validVal) {
            let issuedObj = parseRobustDate(issuedVal);
            let validObj = parseRobustDate(validVal);
            if (issuedObj && validObj && validObj < issuedObj) {
                errs.valid_until = 'Must be on or after the Issued Date';
            }
        }
        
        let amtN = Number((g('amount')||'0').replace(/[^\d.\-]/g,''));
        let surN = Number((g('surcharge')||'0').replace(/[^\d.\-]/g,''));
        let intN = Number((g('interest')||'0').replace(/[^\d.\-]/g,''));
        let dscN = Number((g('discount')||'0').replace(/[^\d.\-]/g,''));
        let expected = amtN + surN + intN - dscN;
        let totalVal = g('total');
        if (totalVal !== '' && !isNaN(Number(totalVal.replace(/[^\d.\-]/g,'')))) {
            if (Math.abs(Number(totalVal.replace(/[^\d.\-]/g,'')) - expected) > 0.01) {
                errs.total = 'Must equal amount + surcharge + interest - discount (' + expected + ')';
            }
        }
    }
    else if (tableId === 'table4') {
        let amtN = Number((g('amount')||'0').replace(/[^\d.\-]/g,''));
        let surN = Number((g('Surcharge')||'0').replace(/[^\d.\-]/g,''));
        let intN = Number((g('Interest')||'0').replace(/[^\d.\-]/g,''));
        let dscN = Number((g('discount')||'0').replace(/[^\d.\-]/g,''));
        let expected = amtN + surN + intN - dscN;
        let totalVal = g('total');
        if (totalVal !== '' && !isNaN(Number(totalVal.replace(/[^\d.\-]/g,'')))) {
            let expectedRounded = Math.round(expected * 100) / 100;
            if (Math.abs(Number(totalVal.replace(/[^\d.\-]/g,'')) - expectedRounded) > 0.001) {
                errs.total = 'Must equal amount + Surcharge + Interest - discount (' + expectedRounded + ')';
            }
        }
        let qf = g('qtr_from'), qt = g('qtr_to');
        if (qf && qt && Number(qt) < Number(qf)) errs.qtr_to = 'Must be >= Qtr From';
    }
}

function validateSingleRow(tableId, row, rowIdx, seenLists) {
  let errs = {};
  let schema = schemas[tableId].RULES;
  
  Object.keys(schema).forEach(k => {
    let rule = schema[k];
    let val = (row[k] == null ? '' : String(row[k])).trim();
    
    if (rule.required && val === '') { errs[k] = 'Required'; return; }
    if (val !== '') {
      if (rule.min && val.length < rule.min) errs[k] = `Min ${rule.min} chars`;
      if (rule.max && val.length > rule.max) errs[k] = `Max ${rule.max} chars`;
      if (rule.allowed && !rule.allowed.includes(val)) errs[k] = `Allowed: ${rule.allowed.join(', ')}`;
      if (rule.numeric) {
        if (!/^\d+(\.\d+)?$/.test(val)) {
            errs[k] = 'Must be numbers only';
        }
      }
      let df = schemas[tableId].DATE_FIELDS || [];
      if (df.includes(k)) {
        let dObj = parseRobustDate(val);
        if (!dObj) {
            errs[k] = "Invalid Date or Format";
        } else {
            // Check if it's already in the strict MM/DD/YYYY format. If not, error so Auto-Correct can fix it.
            let cleanVal = val.replace(/^'+/, '');
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cleanVal)) {
                errs[k] = "Invalid format. Use MM/DD/YYYY (Click Auto-Correct)";
            }
        }
      }
    }
  });

  customValidateRow(tableId, row, errs, seenLists);
  return errs;
}

// Deduplication grouping
function detectDuplicates(tableId, rows) {
    let dups = [];
    if (tableId === 'table1') {
        let map = {};
        rows.forEach((r, idx) => { let b = r?.bin?.trim(); if(b) { map[b] = map[b] || []; map[b].push(idx); } });
        for (let b in map) if(map[b].length > 1) dups.push({table: tableId, keyField: 'bin', keyValue: b, indices: map[b]});
    }
    if (tableId === 'table3') {
        // or_no uniqueness
        let mapOr = {};
        rows.forEach((r, idx) => { let o = r?.or_no?.trim(); if(o) { mapOr[o] = mapOr[o] || []; mapOr[o].push(idx); } });
        for (let o in mapOr) if(mapOr[o].length > 1) dups.push({table: tableId, keyField: 'or_no', keyValue: o, indices: mapOr[o]});

        // permit_no uniqueness (skip blank)
        let mapPm = {};
        rows.forEach((r, idx) => { let p = r?.permit_no?.trim(); if(p) { mapPm[p] = mapPm[p] || []; mapPm[p].push(idx); } });
        for (let p in mapPm) if(mapPm[p].length > 1) dups.push({table: tableId, keyField: 'permit_no', keyValue: p, indices: mapPm[p]});

        // barangay_clearance_number uniqueness (skip blank)
        let mapBc = {};
        rows.forEach((r, idx) => { let b = r?.barangay_clearance_number?.trim(); if(b) { mapBc[b] = mapBc[b] || []; mapBc[b].push(idx); } });
        for (let b in mapBc) if(mapBc[b].length > 1) dups.push({table: tableId, keyField: 'barangay_clearance_number', keyValue: b, indices: mapBc[b]});
    }
    return dups;
}

function runLiveValidation(changedRow, changedKey, inputEl) {
  let st = appState[activeTableId];
  let seenLists = {};
  
  let errs = validateSingleRow(activeTableId, st.rows[changedRow], changedRow, seenLists);
  if (Object.keys(errs).length > 0) {
      st.cellErrors[changedRow] = errs;
      auditLog.push({table: activeTableId, row: changedRow+1, type: 'ERROR', message: `${changedKey}: ${errs[changedKey]}`});
  } else { 
      delete st.cellErrors[changedRow]; 
  }
  
  updateStatusUI();
  
  let tr = inputEl.closest('tr');
  let hasRowErr = st.cellErrors[changedRow] !== undefined;
  tr.className = hasRowErr ? 'has-error' : '';
  
  tr.querySelectorAll('.cell-input').forEach(inp => {
    let k = inp.dataset.col;
    let err = st.cellErrors[changedRow]?.[k];
    let isAuto = st.autocorrectedCells[changedRow] && st.autocorrectedCells[changedRow].has(k);
    inp.className = 'cell-input' + (err ? ' cell-err' : (isAuto ? ' cell-autocorrected' : ' cell-ok'));
  });
}

function processDuplicatesModal() {
    if (pendingDuplicates.length === 0) return;
    let dup = pendingDuplicates.shift();
    let st = appState[dup.table];
    
    document.getElementById('dupModal').style.display = 'flex';
    let container = document.getElementById('dupCards');
    container.innerHTML = '';
    
    dup.indices.forEach(rowIdx => {
        let row = st.rows[rowIdx];
        if(!row) return; // already deleted
        let card = document.createElement('div');
        card.className = 'dup-card';
        let html = `<div style="font-weight:bold; margin-bottom:10px;">Row ${rowIdx+1} (${dup.keyField}: ${dup.keyValue})</div>`;
        
        let schema = schemas[dup.table];
        schema.FIELD_ORDER.slice(0, 8).forEach(f => {
            if (row[f]) html += `<div class="dup-field"><strong>${f}</strong><span>${escapeHtml(row[f])}</span></div>`;
        });
        
        html += `<button class="btn btn-primary" style="margin-top:15px;width:100%;justify-content:center;">Keep This Row</button>`;
        card.innerHTML = html;
        
        card.querySelector('button').addEventListener('click', () => {
            // Delete the other rows
            dup.indices.forEach(idx => {
                if (idx !== rowIdx) {
                    st.rows[idx] = null; // Mark for deletion
                    auditLog.push({table: dup.table, row: idx+1, type: 'DEDUPLICATION', message: `Discarded duplicate ${dup.keyField} ${dup.keyValue}`});
                } else {
                    auditLog.push({table: dup.table, row: idx+1, type: 'DEDUPLICATION', message: `Kept record for ${dup.keyField} ${dup.keyValue}`});
                }
            });
            // Compact rows
            st.rows = st.rows.filter(r => r !== null);
            
            document.getElementById('dupModal').style.display = 'none';
            
            if (pendingDuplicates.length > 0) {
                processDuplicatesModal();
            } else {
                // Done deduplicating this table
                finalizeValidation(dup.table);
            }
        });
        container.appendChild(card);
    });
}

document.getElementById('skipDup').addEventListener('click', () => {
    document.getElementById('dupModal').style.display = 'none';
    let dup = pendingDuplicates[0];
    if(dup) auditLog.push({table: dup.table, row: 'System', type: 'DEDUPLICATION', message: `Skipped manual resolution for ${dup.keyField} ${dup.keyValue}`});
    
    if (pendingDuplicates.length > 0) {
        processDuplicatesModal();
    } else {
        finalizeValidation(activeTableId);
    }
});
document.getElementById('closeDupModal').addEventListener('click', () => {
    document.getElementById('dupModal').style.display = 'none';
    pendingDuplicates = [];
    finalizeValidation(activeTableId);
});

const VALIDATE_ORDER = ['table1', 'table2', 'table3', 'table4'];

function emitCrossTableTips(tableId) {
    const tips = [];
    const needsBinParent = tableId === 'table2' || tableId === 'table3' || tableId === 'table4';
    if (needsBinParent && !(appState.table1.loaded && appState.table1.hasValidated)) {
        tips.push('Tip: Cross-table BIN check is off until you load and validate the Business sheet.');
    }
    if (tableId === 'table4' && !(appState.table3.loaded && appState.table3.hasValidated)) {
        tips.push('Tip: Cross-table OR check is off until you load and validate the Application sheet.');
    }
    tips.forEach(msg => {
        auditLog.push({ table: tableId, row: 'System', type: 'INFO', message: msg });
    });
    return tips;
}

document.getElementById('validateBtn').addEventListener('click', () => {
    VALIDATE_ORDER.forEach(tid => {
        if (appState[tid].loaded) executeValidation(tid);
    });
});

function executeValidation(tableId) {
    let st = appState[tableId];
    st.hasValidated = true;
    st.cellErrors = {};
    let seenLists = {};
    
    let dups = detectDuplicates(tableId, st.rows);
    if (dups.length > 0) {
        pendingDuplicates = pendingDuplicates.concat(dups);
        if (tableId === activeTableId) processDuplicatesModal();
        return; 
    }
    
    finalizeValidation(tableId);
}

function finalizeValidation(tableId) {
    let st = appState[tableId];
    let seenLists = {};
    let crossTips = emitCrossTableTips(tableId);
    
    if (tableId === 'table1') MasterStore.validBINs.clear();
    if (tableId === 'table3') MasterStore.validORs.clear();

    if (tableId === 'table1') {
        st.rows.forEach(row => {
            if (!row) return;
            let bin = normalizeBIN(row['bin']);
            if (bin) MasterStore.validBINs.add(bin);
        });
    }
    if (tableId === 'table3') {
        st.rows.forEach(row => {
            if (!row) return;
            let orNo = (row['or_no'] == null ? '' : String(row['or_no'])).trim();
            if (orNo) MasterStore.validORs.add(orNo);
        });
    }

    st.rows.forEach((row, idx) => {
        if(!row) return;
        let errs = validateSingleRow(tableId, row, idx, seenLists);
        if (Object.keys(errs).length > 0) {
            st.cellErrors[idx] = errs;
        }
    });
    
    if(tableId === activeTableId) {
        currentPage = 1;
        renderTable();
        updateStatusUI();
        if (crossTips.length > 0) {
            const s = document.getElementById('status');
            s.innerHTML = (s.innerHTML ? s.innerHTML + '<br>' : '') + crossTips.map(t => escapeHtml(t)).join('<br>');
        }
        document.getElementById('exportBtn').style.display = 'inline-flex';
        document.getElementById('exportAuditBtn').style.display = auditLog.length > 0 ? 'inline-flex' : 'none';
    }
}

function updateStatusUI() {
    let st = appState[activeTableId];
    if(!st.loaded) return;
    
    let errCount = Object.keys(st.cellErrors).reduce((acc, idx) => acc + Object.keys(st.cellErrors[idx]).length, 0);
    
    const s = document.getElementById('status');
    const sum = document.getElementById('errorSummary');
    
    if (!st.hasValidated) {
        s.className = 'status-info';
        s.innerHTML = `Table ${activeTableId} loaded (${st.rows.length} rows). Click Validate.`;
        sum.style.display = 'none';
    } else if (errCount === 0) {
        s.className = 'status-ok';
        s.innerHTML = `✅ All ${st.rows.length} rows valid in ${activeTableId}. Ready for export.`;
        sum.style.display = 'none';
    } else {
        s.className = 'status-err';
        s.innerHTML = `❌ Found ${errCount} error(s) across ${Object.keys(st.cellErrors).length} row(s) in ${activeTableId}. Hover over red cells to see fixes.`;
        sum.style.display = 'block';
        
        let html = `<h4><span style="font-size:16px">⚠</span> Error Summary (${errCount})</h4>`;
        let counter = 0;
        Object.entries(st.cellErrors).forEach(([r, errs]) => {
            if (counter > 50) return; 
            let errStr = Object.entries(errs).map(([k,v]) => `<b>${k}</b>: ${v}`).join(' | ');
            html += `<div class="err-row">Row ${(Number(r)+1)}: ${errStr}</div>`;
            counter++;
        });
        if(Object.keys(st.cellErrors).length > 50) html += `<div class="err-row">...and more. Check Audit Log.</div>`;
        sum.innerHTML = html;
    }
}

function customAutoCorrect(tableId, row, fixes) {
    const v = (k) => (row[k] == null ? '' : String(row[k])).trim();
    if (tableId === 'table1') {
        let bin = v('bin');
        if (bin && bin.includes(' ')) { row.bin = bin.replace(/\s+/g, ''); fixes.push('bin: removed spaces'); }
        
        let cell = v('cellphone_no');
        if (cell) {
            // Handle Excel scientific notation: 6.39E+11 → 639000000000
            let normalized = cell;
            if (/^\d+\.?\d*[eE][+\-]?\d+$/.test(cell)) {
                normalized = String(Math.round(Number(cell)));
            }
            let digits = normalized.replace(/[^\d]/g, '');
            if (digits.startsWith('639') && digits.length === 12) { row.cellphone_no = digits; fixes.push('cellphone_no: normalized from scientific/raw notation'); }
            else if (digits.startsWith('09') && digits.length === 11) { row.cellphone_no = '639' + digits.substring(2); fixes.push('cellphone_no: converted 09xx to 639xx'); }
            else if (digits.startsWith('9') && digits.length === 10) { row.cellphone_no = '639' + digits.substring(1); fixes.push('cellphone_no: converted 9xx to 639xx'); }
        }
        
        let sex = v('incharge_sex').toUpperCase();
        if (sex === 'MALE') { row.incharge_sex = 'M'; fixes.push('incharge_sex: converted MALE to M'); }
        else if (sex === 'FEMALE') { row.incharge_sex = 'F'; fixes.push('incharge_sex: converted FEMALE to F'); }
        
        let loc = v('location_owned').toLowerCase();
        if (['yes', 'true', 'owned', '1.0'].includes(loc)) { row.location_owned = '1'; fixes.push('location_owned: converted to 1'); }
        else if (['no', 'false', 'rented', '0.0'].includes(loc)) { row.location_owned = '0'; fixes.push('location_owned: converted to 0'); }
        else if (loc !== '1' && loc !== '0' && loc !== '') { row.location_owned = ''; fixes.push('location_owned: cleared invalid'); }

        let ext = v('incharge_extension_name');
        if (ext && ext.includes('.')) {
            row.incharge_extension_name = ext.replace(/\./g, '').trim();
            fixes.push('incharge_extension_name: removed periods');
        }

        let tin = v('tin_no');
        if (tin) {
            let d = tin.replace(/[^\d]/g, '');
            let formatted = d.substring(0,3) + '-' + d.substring(3,6) + '-' + d.substring(6,9) + '-' + d.substring(9,14);
            if (d.length === 14 && tin !== formatted) {
                row.tin_no = formatted;
                fixes.push('tin_no: auto-formatted to 000-000-000-00000');
            }
        }

        let pin = v('pin_no');
        if (pin) {
            let d = pin.replace(/[^\d]/g, '');
            if (d.length === 13 && pin !== (d.substring(0,3)+'-'+d.substring(3,5)+'-'+d.substring(5,8)+'-'+d.substring(8,10)+'-'+d.substring(10,13))) {
                row.pin_no = d.substring(0,3) + '-' + d.substring(3,5) + '-' + d.substring(5,8) + '-' + d.substring(8,10) + '-' + d.substring(10,13);
                fixes.push('pin_no: auto-formatted');
            }
        }

        ['floor_area','area','monthly_rental','no_of_male_employees','no_of_female_employees','no_of_employees_residing_within_the_area','no_of_van','no_of_truck','no_of_motorcycle'].forEach(f => {
            let val = v(f);
            if (val && val.includes('%')) {
                let parsed = parseFloat(val.replace(/%/g, ''));
                if (!isNaN(parsed)) {
                    row[f] = String(parsed / 100);
                    fixes.push(f + ': removed excel percentage formatting');
                }
            }
        });
    }
    if (tableId === 'table3') {
        let appType = v('application_type').toUpperCase();
        if (appType === 'NEW') { row.application_type = 'N'; fixes.push('application_type: converted NEW to N'); }
        else if (appType === 'RENEWAL') { row.application_type = 'R'; fixes.push('application_type: converted RENEWAL to R'); }
        else if (appType === 'QUARTERLY') { row.application_type = 'Q'; fixes.push('application_type: converted QUARTERLY to Q'); }

        let amtN = Number(v('amount').replace(/[^\d.\-]/g,'') || 0);
        let surN = Number(v('surcharge').replace(/[^\d.\-]/g,'') || 0);
        let intN = Number(v('interest').replace(/[^\d.\-]/g,'') || 0);
        let dscN = Number(v('discount').replace(/[^\d.\-]/g,'') || 0);
        let expectedTotal = amtN + surN + intN - dscN;
        let currentTotal = v('total').replace(/[^\d.\-]/g,'');
        if (!isNaN(amtN) && !isNaN(surN) && !isNaN(intN) && !isNaN(dscN)) {
            if (currentTotal === '' || Number(currentTotal) !== expectedTotal) {
                row.total = expectedTotal.toString();
                fixes.push('total: auto-calculated');
            }
        }
    }
    if (tableId === 'table4') {
        let code = v('code');
        if (code && code.includes(' ')) {
            row.code = code.replace(/\s+/g, '');
            fixes.push('code: removed spaces');
        }

        // Strip Excel comma-formatting from all numeric fields (e.g. "4,000.00" → "4000.00")
        ['amount','discount','Interest','Surcharge','total'].forEach(f => {
            let raw = v(f);
            if (raw && raw.includes(',')) {
                let stripped = raw.replace(/,/g, '');
                if (!isNaN(Number(stripped))) {
                    row[f] = stripped;
                    fixes.push(f + ': removed comma formatting');
                }
            }
        });

        let amtN = Number(v('amount').replace(/[^\d.\-]/g,'') || 0);
        let surN = Number(v('Surcharge').replace(/[^\d.\-]/g,'') || 0);
        let intN = Number(v('Interest').replace(/[^\d.\-]/g,'') || 0);
        let dscN = Number(v('discount').replace(/[^\d.\-]/g,'') || 0);
        let expectedTotal = Math.round((amtN + surN + intN - dscN) * 100) / 100;
        let currentTotal = v('total').replace(/[^\d.\-]/g,'');
        if (!isNaN(amtN) && !isNaN(surN) && !isNaN(intN) && !isNaN(dscN)) {
            if (currentTotal === '' || Number(currentTotal) !== expectedTotal) {
                row.total = String(expectedTotal);
                fixes.push('total: auto-calculated');
            }
        }
    }
}

document.getElementById('autocorrectBtn').addEventListener('click', () => {
    Object.keys(appState).forEach(tid => {
        let st = appState[tid];
        if(!st.loaded) return;
        
        st.autocorrectedCells = {};
        let df = schemas[tid] && schemas[tid].DATE_FIELDS ? schemas[tid].DATE_FIELDS : [];
        
        st.rows.forEach((row, idx) => {
            if(!row) return;
            let fixes = [];
            
            Object.keys(row).forEach(k => {
                let orig = String(row[k]||'').trim();
                let fixed = orig;
                if (df.includes(k) && orig) {
                    fixed = formatDate(orig);
                }
                let rule = schemas[tid].RULES[k];
                if (rule && rule.allowed && orig) {
                    let upper = orig.toUpperCase().trim();
                    if (rule.allowed.includes(upper)) fixed = upper;
                }
                if (rule && rule.numeric && fixed) {
                    let nStr = fixed.replace(/[^\d.\-]/g, '');
                    if (nStr !== fixed && nStr !== '') fixed = nStr;
                }
                if (fixed !== orig) {
                    fixes.push(`${k}: formatted`);
                    row[k] = fixed;
                }
            });
            
            customAutoCorrect(tid, row, fixes);
            
            if (fixes.length > 0) {
                st.autocorrectedCells[idx] = new Set(fixes.map(f => f.split(':')[0]));
                fixes.forEach(f => {
                    auditLog.push({table: tid, row: idx+1, type: 'AUTOCORRECT', message: f});
                });
            }
        });
    });
    
    document.getElementById('validateBtn').click();
    alert('Autocorrect complete. Check Audit Log for details.');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  let st = appState[activeTableId];
  
  let errCount = Object.keys(st.cellErrors).reduce((acc, idx) => acc + Object.keys(st.cellErrors[idx]).length, 0);
  if (errCount > 0) {
      if (!confirm(`Warning: You have ${errCount} unresolved error(s) in this table.\n\nAre you sure you want to export and ignore these errors? Click OK to export anyway, or Cancel to continue correcting.`)) {
          return;
      }
  }

  let finalRows = st.rows.map(r => {
    if(!r) return null;
    let out = {};
    st.headers.forEach(h => {
      let v = String(r[h] || '').trim();

      // Strip leading quote prefix (used internally for Excel display) — export raw value for PHP
      if (v.startsWith("'")) v = v.substring(1);

      // Date fields: export as plain m/d/Y (e.g. 04/14/2028) — matches PHP DateTime::createFromFormat('m/d/Y')
      // NOTE: Do NOT re-wrap with ="..." — that breaks PHP's CSV date parser.
      // Excel may reformat dates on open, but the raw CSV file on disk is always correct for PHP import.

      out[h] = v;
    });
    return out;
  }).filter(r => r !== null);
  
  let csv = Papa.unparse(finalRows, { columns: st.headers });
  let blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  let link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'validated_' + activeTableId + '_' + Date.now() + '.csv';
  link.click();
});

document.getElementById('exportAuditBtn').addEventListener('click', () => {
    let csv = Papa.unparse(auditLog, { columns: ['table', 'row', 'type', 'message'] });
    let blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'bpls_audit_log_' + Date.now() + '.csv';
    link.click();
});

// Rules Editor Logic
const modal = document.getElementById('rulesModal');
const rulesSelect = document.getElementById('rulesTableSelect');
const rulesEditor = document.getElementById('rulesEditor');

document.getElementById('rulesBtn').addEventListener('click', () => {
  rulesSelect.value = activeTableId || 'table1';
  loadEditorRules();
  modal.style.display = 'flex';
});

document.getElementById('closeModal').addEventListener('click', () => modal.style.display='none');

rulesSelect.addEventListener('change', loadEditorRules);

function loadEditorRules() {
  let val = rulesSelect.value;
  rulesEditor.value = JSON.stringify(schemas[val].RULES, null, 2);
}

document.getElementById('saveRules').addEventListener('click', () => {
  try {
    let newRules = JSON.parse(rulesEditor.value);
    schemas[rulesSelect.value].RULES = newRules;
    localStorage.setItem('bpls_rules_' + rulesSelect.value, JSON.stringify(newRules));
    alert('✅ Rules saved successfully for ' + rulesSelect.value + '!');
    document.getElementById('validateBtn').click();
  } catch(e) {
    alert('❌ Invalid JSON syntax. Please check your formatting.');
  }
});

document.getElementById('resetRules').addEventListener('click', () => {
  if(confirm('Reset ' + rulesSelect.value + ' validation rules to system defaults?')) {
    localStorage.removeItem('bpls_rules_' + rulesSelect.value);
    alert('To fully apply defaults, please reload the page.');
    location.reload();
  }
});
