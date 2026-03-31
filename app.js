/* ============================================
   ELLECTRA — Workshop Certificate Generator
   Firebase Firestore + localStorage fallback
   ============================================ */

// ═══════════════════════════════════════════
// FIREBASE CONFIGURATION
// ═══════════════════════════════════════════
const firebaseConfig = {
    apiKey: "AIzaSyBsDRgNuzGF9tlIR42vAnXhNagpc6Nqyiw",
    authDomain: "certifomaker.firebaseapp.com",
    projectId: "certifomaker",
    storageBucket: "certifomaker.firebasestorage.app",
    messagingSenderId: "793743251907",
    appId: "1:793743251907:web:713cf59dfe053ecc748576"
};

// ═══════════════════════════════════════════
// DATABASE INITIALIZATION
// ═══════════════════════════════════════════
let db = null;
let useFirebase = false;

function initFirebase() {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            console.warn("Persistence error:", err.code);
        });
        useFirebase = true;
        console.log("✅ Firebase Firestore connected!");
        updateDbBadge("firebase");
        return true;
    } catch (error) {
        console.error("❌ Firebase init failed:", error);
        updateDbBadge("error");
        return false;
    }
}

function updateDbBadge(status) {
    const badge = document.getElementById("dbStatus");
    switch (status) {
        case "firebase":
            badge.className = "db-badge db-firebase";
            badge.innerHTML = '<i class="fas fa-cloud"></i> Firebase';
            break;
        case "local":
            badge.className = "db-badge db-local";
            badge.innerHTML = '<i class="fas fa-database"></i> Local Storage';
            break;
        case "error":
            badge.className = "db-badge db-error";
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Local (Firebase Error)';
            break;
        default:
            badge.className = "db-badge db-loading";
            badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    }
}

// ═══════════════════════════════════════════
// STORAGE ABSTRACTION LAYER
// ═══════════════════════════════════════════
const Storage = {
    async save(certData) {
        if (useFirebase) {
            try {
                const docRef = await db.collection("certificates").add({
                    ...certData,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdAtLocal: new Date().toISOString()
                });
                return docRef.id;
            } catch (error) {
                console.error("Firebase save error:", error);
                return this._saveLocal(certData);
            }
        } else {
            return this._saveLocal(certData);
        }
    },

    _saveLocal(certData) {
        const certs = JSON.parse(localStorage.getItem("ellectra_certs") || "[]");
        certData._localId = "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
        certData.createdAt = new Date().toISOString();
        certData.createdAtLocal = new Date().toISOString();
        certs.push(certData);
        localStorage.setItem("ellectra_certs", JSON.stringify(certs));
        return certData._localId;
    },

    async getAll() {
        if (useFirebase) {
            try {
                const snapshot = await db.collection("certificates")
                    .orderBy("createdAt", "desc")
                    .get();
                return snapshot.docs.map(doc => ({ _docId: doc.id, ...doc.data() }));
            } catch (error) {
                return this._getAllLocal();
            }
        } else {
            return this._getAllLocal();
        }
    },

    _getAllLocal() {
        const certs = JSON.parse(localStorage.getItem("ellectra_certs") || "[]");
        return certs.reverse();
    },

    async remove(id) {
        if (useFirebase) {
            try {
                await db.collection("certificates").doc(id).delete();
            } catch (error) {
                this._removeLocal(id);
            }
        } else {
            this._removeLocal(id);
        }
    },

    _removeLocal(id) {
        let certs = JSON.parse(localStorage.getItem("ellectra_certs") || "[]");
        certs = certs.filter(c => c._localId !== id);
        localStorage.setItem("ellectra_certs", JSON.stringify(certs));
    },

    async clearAll() {
        if (useFirebase) {
            try {
                const snapshot = await db.collection("certificates").get();
                const batch = db.batch();
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            } catch (error) {
                localStorage.removeItem("ellectra_certs");
            }
        } else {
            localStorage.removeItem("ellectra_certs");
        }
    },

    async count() {
        const all = await this.getAll();
        return all.length;
    }
};

// ═══════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════
let currentTemplate = "classic";
let currentCertFor = "participant"; // "participant" or "winner"
let allCertificates = [];
let downloadCount = parseInt(localStorage.getItem("ellectra_downloads") || "0");
let currentViewCert = null;

// ═══════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    initFirebase();

    document.getElementById("workshopDate").value = todayISO();
    updatePreview();
    scalePreview();
    window.addEventListener("resize", scalePreview);

    document.getElementById("navToggle").addEventListener("click", () => {
        document.getElementById("navLinks").classList.toggle("open");
    });

    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            showSection(link.dataset.section);
            document.getElementById("navLinks").classList.remove("open");
        });
    });

    document.getElementById("modalOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
    });

    await refreshData();

    setTimeout(() => {
        document.getElementById("loading-screen").classList.add("hidden");
    }, 1200);
});

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showSection(name) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));

    document.getElementById("section-" + name).classList.add("active");
    document.querySelector(`.nav-link[data-section="${name}"]`).classList.add("active");

    if (name === "history") loadHistory();
    if (name === "dashboard") refreshData();
    if (name === "create") {
        setTimeout(scalePreview, 150);
        updatePreview();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════
// CERTIFICATE FOR SELECTION (Participant / Winner)
// ═══════════════════════════════════════════
function selectCertFor(type) {
    currentCertFor = type;

    document.querySelectorAll(".cert-type-option").forEach(o => o.classList.remove("active"));
    document.querySelector(`.cert-type-option[data-certfor="${type}"]`).classList.add("active");

    // Show/hide winner position
    const winnerGroup = document.getElementById("winnerPositionGroup");
    winnerGroup.style.display = type === "winner" ? "block" : "none";

    // Update certificate class
    const cert = document.getElementById("certificatePreview");
    if (type === "winner") {
        cert.classList.remove("cert-participant");
        cert.classList.add("cert-winner");
    } else {
        cert.classList.remove("cert-winner");
        cert.classList.add("cert-participant");
    }

    updatePreview();
}

// ═══════════════════════════════════════════
// TEMPLATE SELECTION
// ═══════════════════════════════════════════
function selectTemplate(name) {
    currentTemplate = name;

    document.querySelectorAll(".template-option").forEach(o => o.classList.remove("active"));
    document.querySelector(`.template-option[data-template="${name}"]`).classList.add("active");

    const cert = document.getElementById("certificatePreview");
    // Preserve cert-winner or cert-participant class
    const isWinner = cert.classList.contains("cert-winner");
    cert.className = `certificate template-${name} ${isWinner ? 'cert-winner' : 'cert-participant'}`;

    updatePreview();
}

// ═══════════════════════════════════════════
// LIVE PREVIEW
// ═══════════════════════════════════════════
function updatePreview() {
    const recipientName = document.getElementById("recipientName").value || "Participant Name";
    const workshopType = document.getElementById("workshopType").value || "Workshop";
    const workshopName = document.getElementById("workshopName").value || "Workshop Name";
    const institutionName = document.getElementById("institutionName").value || "Institution Name";
    const description = document.getElementById("description").value || "";
    const workshopDate = document.getElementById("workshopDate").value;
    const issuerName = document.getElementById("issuerName").value || "Signer Name";
    const issuerTitle = document.getElementById("issuerTitle").value || "Workshop Coordinator";
    const orgName = document.getElementById("orgName").value || "Ellectra";

    document.getElementById("prevName").textContent = recipientName;
    document.getElementById("prevWorkshopName").textContent = workshopName;
    document.getElementById("prevDesc").textContent = description;
    document.getElementById("prevIssuer").textContent = issuerName;
    document.getElementById("prevIssuerTitle").textContent = issuerTitle;
    document.getElementById("prevOrg").textContent = orgName;
    document.getElementById("prevDate").textContent = workshopDate ? formatDate(workshopDate) : "Date";
    document.getElementById("prevId").textContent = "ID: " + generateCertId();

    // Workshop type label
    document.getElementById("prevWorkshopType").textContent = workshopType + " Certificate";

    // Institution
    document.getElementById("prevInstitution").textContent = "Conducted at: " + institutionName;

    // Cert type (participation vs winner)
    if (currentCertFor === "winner") {
        const winnerPos = document.getElementById("winnerPosition").value;
        document.getElementById("prevType").textContent = "OF ACHIEVEMENT";
        
        // Update or create winner position element
        let posEl = document.getElementById("prevWinnerPosition");
        if (!posEl) {
            posEl = document.createElement("div");
            posEl.id = "prevWinnerPosition";
            posEl.className = "cert-winner-position";
            const certBody = document.querySelector("#certificatePreview .cert-body");
            certBody.insertBefore(posEl, certBody.querySelector(".cert-presented"));
        }
        posEl.textContent = "🏆 " + winnerPos;
        posEl.style.display = "inline-block";

        // Change "for" text
        document.querySelector("#certificatePreview .cert-for").textContent = "for outstanding achievement in the workshop";

        // Change seal
        document.querySelector("#certificatePreview .cert-seal-inner").textContent = "🏆";
    } else {
        document.getElementById("prevType").textContent = "OF PARTICIPATION";
        
        let posEl = document.getElementById("prevWinnerPosition");
        if (posEl) posEl.style.display = "none";

        document.querySelector("#certificatePreview .cert-for").textContent = "for successfully participating in the workshop";
        document.querySelector("#certificatePreview .cert-seal-inner").textContent = "⚡";
    }
}

// ═══════════════════════════════════════════
// PREVIEW SCALING
// ═══════════════════════════════════════════
function scalePreview() {
    const container = document.getElementById("previewContainer");
    const scaler = document.getElementById("previewScaler");
    if (!container || !scaler) return;

    const availableWidth = container.clientWidth - 40;
    const certWidth = 800;
    const certHeight = 566;
    const scale = Math.min(1, availableWidth / certWidth);

    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = "top center";
    container.style.height = (certHeight * scale + 40) + "px";
}

// ═══════════════════════════════════════════
// GENERATE PDF & SAVE
// ═══════════════════════════════════════════
async function generateAndSave() {
    const recipientName = document.getElementById("recipientName").value.trim();
    const workshopType = document.getElementById("workshopType").value.trim();
    const workshopName = document.getElementById("workshopName").value.trim();
    const institutionName = document.getElementById("institutionName").value.trim();
    const workshopDate = document.getElementById("workshopDate").value;
    const issuerName = document.getElementById("issuerName").value.trim();

    const errors = [];
    if (!recipientName) errors.push("Participant/Winner Name");
    if (!workshopType) errors.push("Workshop Type");
    if (!workshopName) errors.push("Workshop Name");
    if (!institutionName) errors.push("Institution/School");
    if (!workshopDate) errors.push("Workshop Date");
    if (!issuerName) errors.push("Signed By");

    if (errors.length > 0) {
        showToast(`Please fill: ${errors.join(", ")}`, "error");
        return;
    }

    const btn = document.getElementById("btnGenerate");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating PDF...';

    try {
        const certId = generateCertId();
        const description = document.getElementById("description").value.trim();
        const issuerTitle = document.getElementById("issuerTitle").value.trim() || "Workshop Coordinator";
        const orgName = document.getElementById("orgName").value.trim() || "Ellectra";
        const winnerPosition = currentCertFor === "winner" ? document.getElementById("winnerPosition").value : "";

        document.getElementById("prevId").textContent = "ID: " + certId;
        await delay(100);

        const certData = {
            certId,
            recipientName,
            workshopType,
            workshopName,
            institutionName,
            description,
            workshopDate,
            issuerName,
            issuerTitle,
            orgName,
            certFor: currentCertFor,
            winnerPosition,
            template: currentTemplate
        };

        showToast("Saving to database...", "info");
        await Storage.save(certData);

        showToast("Generating PDF...", "info");
        await generatePDF(certId, recipientName);

        downloadCount++;
        localStorage.setItem("ellectra_downloads", downloadCount.toString());

        showToast(`✅ Certificate "${certId}" saved & PDF downloaded!`, "success");
        await refreshData();

    } catch (err) {
        console.error("Generation error:", err);
        showToast("Error: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-pdf"></i> Generate PDF & Save';
    }
}

// ═══════════════════════════════════════════
// PDF GENERATION ENGINE
// ═══════════════════════════════════════════
async function generatePDF(certId, recipientName) {
    const cert = document.getElementById("certificatePreview");
    const scaler = document.getElementById("previewScaler");
    const container = document.getElementById("previewContainer");

    const savedTransform = scaler.style.transform;
    const savedHeight = container.style.height;

    scaler.style.transform = "scale(1)";
    container.style.height = "auto";
    container.style.overflow = "visible";

    await document.fonts.ready;
    await delay(500);

    const canvas = await html2canvas(cert, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: null,
        width: 800,
        height: 566,
        windowWidth: 800,
        windowHeight: 566
    });

    scaler.style.transform = savedTransform;
    container.style.height = savedHeight;
    container.style.overflow = "auto";

    const imgData = canvas.toDataURL("image/png", 1.0);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const availW = pageW - 2 * margin;
    const availH = pageH - 2 * margin;
    const imgRatio = 800 / 566;

    let imgW, imgH;
    if (availW / availH > imgRatio) {
        imgH = availH;
        imgW = imgH * imgRatio;
    } else {
        imgW = availW;
        imgH = imgW / imgRatio;
    }

    const x = (pageW - imgW) / 2;
    const y = (pageH - imgH) / 2;

    pdf.addImage(imgData, "PNG", x, y, imgW, imgH);
    pdf.setProperties({
        title: `Workshop Certificate - ${recipientName}`,
        subject: `Certificate ID: ${certId}`,
        author: "Ellectra",
        creator: "Ellectra Workshop Certificate Generator"
    });

    const filename = `${certId}_${recipientName.replace(/\s+/g, "_")}.pdf`;
    pdf.save(filename);
    return filename;
}

// ═══════════════════════════════════════════
// VIEW & REDOWNLOAD CERTIFICATE
// ═══════════════════════════════════════════
function viewCertificate(certDataJSON) {
    const certData = JSON.parse(decodeURIComponent(certDataJSON));
    currentViewCert = certData;

    const isWinner = certData.certFor === "winner";
    const modalScaler = document.getElementById("modalPreviewScaler");

    const winnerPositionHtml = isWinner ? 
        `<div class="cert-winner-position">🏆 ${escapeHtml(certData.winnerPosition || 'Winner')}</div>` : '';
    
    const forText = isWinner ? 
        'for outstanding achievement in the workshop' : 
        'for successfully participating in the workshop';
    
    const sealIcon = isWinner ? '🏆' : '⚡';
    const certOfText = isWinner ? 'OF ACHIEVEMENT' : 'OF PARTICIPATION';
    const certClass = isWinner ? 'cert-winner' : 'cert-participant';

    modalScaler.innerHTML = `
        <div class="certificate template-${certData.template} ${certClass}" id="modalCertificate">
            <div class="cert-watermark">⚡</div>
            <div class="cert-outer">
                <div class="cert-inner">
                    <div class="cert-corner cert-tl">❖</div>
                    <div class="cert-corner cert-tr">❖</div>
                    <div class="cert-corner cert-bl">❖</div>
                    <div class="cert-corner cert-br">❖</div>

                    <div class="cert-header">
                        <div class="cert-logo-row">
                            <img src="https://raw.githubusercontent.com/pprojectcentreee/Ellectra/main/Ellectra_w01wap%20(2).png" alt="Ellectra" class="cert-logo-img" crossorigin="anonymous">
                        </div>
                        <div class="cert-org-name">${escapeHtml(certData.orgName || 'Ellectra')}</div>
                        <div class="cert-workshop-type-label">${escapeHtml(certData.workshopType || 'Workshop')} Certificate</div>
                        <h1 class="cert-title">CERTIFICATE</h1>
                        <div class="cert-of">${certOfText}</div>
                        <div class="cert-line-deco">
                            <span class="line-side"></span>
                            <span class="line-diamond">⚡</span>
                            <span class="line-side"></span>
                        </div>
                    </div>

                    <div class="cert-body">
                        ${winnerPositionHtml}
                        <p class="cert-presented">This certificate is proudly presented to</p>
                        <h2 class="cert-recipient">${escapeHtml(certData.recipientName)}</h2>
                        <div class="cert-underline"></div>
                        <p class="cert-for">${forText}</p>
                        <h3 class="cert-course">${escapeHtml(certData.workshopName || certData.courseName || '')}</h3>
                        <p class="cert-institution">Conducted at: ${escapeHtml(certData.institutionName || '')}</p>
                        <p class="cert-desc">${escapeHtml(certData.description || '')}</p>
                    </div>

                    <div class="cert-footer">
                        <div class="cert-sign-block">
                            <div class="cert-sign-line"></div>
                            <p class="cert-sign-name">${escapeHtml(certData.issuerName)}</p>
                            <p class="cert-sign-role">${escapeHtml(certData.issuerTitle || 'Workshop Coordinator')}</p>
                        </div>
                        <div class="cert-seal-block">
                            <div class="cert-seal">
                                <div class="cert-seal-inner">${sealIcon}</div>
                            </div>
                        </div>
                        <div class="cert-date-block">
                            <div class="cert-sign-line"></div>
                            <p class="cert-date-val">${formatDate(certData.workshopDate || certData.issueDate)}</p>
                            <p class="cert-sign-role">Workshop Date</p>
                        </div>
                    </div>

                    <div class="cert-id">ID: ${certData.certId}</div>
                </div>
            </div>
        </div>
    `;

    const modalContainer = document.getElementById("modalPreviewContainer");
    setTimeout(() => {
        const availableWidth = modalContainer.clientWidth - 30;
        const scale = Math.min(1, availableWidth / 800);
        modalScaler.style.transform = `scale(${scale})`;
        modalScaler.style.transformOrigin = "top center";
        modalContainer.style.height = (566 * scale + 30) + "px";
    }, 100);

    document.getElementById("modalOverlay").classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeModal() {
    document.getElementById("modalOverlay").classList.remove("active");
    document.body.style.overflow = "";
    currentViewCert = null;
}

async function redownloadPDF() {
    if (!currentViewCert) return;

    const btn = document.getElementById("btnRedownload");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating...';

    try {
        const cert = document.getElementById("modalCertificate");
        const modalScaler = document.getElementById("modalPreviewScaler");
        const savedTransform = modalScaler.style.transform;
        modalScaler.style.transform = "scale(1)";

        await document.fonts.ready;
        await delay(400);

        const canvas = await html2canvas(cert, {
            scale: 3,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: null,
            width: 800,
            height: 566
        });

        modalScaler.style.transform = savedTransform;

        const imgData = canvas.toDataURL("image/png", 1.0);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgRatio = 800 / 566;
        const margin = 8;
        const availW = pageW - 2 * margin;
        const availH = pageH - 2 * margin;

        let imgW, imgH;
        if (availW / availH > imgRatio) {
            imgH = availH;
            imgW = imgH * imgRatio;
        } else {
            imgW = availW;
            imgH = imgW / imgRatio;
        }

        const x = (pageW - imgW) / 2;
        const y = (pageH - imgH) / 2;

        pdf.addImage(imgData, "PNG", x, y, imgW, imgH);
        pdf.setProperties({
            title: `Workshop Certificate - ${currentViewCert.recipientName}`,
            subject: `Certificate ID: ${currentViewCert.certId}`,
            author: "Ellectra"
        });

        pdf.save(`${currentViewCert.certId}_${currentViewCert.recipientName.replace(/\s+/g, "_")}.pdf`);

        downloadCount++;
        localStorage.setItem("ellectra_downloads", downloadCount.toString());
        showToast("PDF downloaded successfully!", "success");

    } catch (err) {
        console.error("Redownload error:", err);
        showToast("Download failed: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-pdf"></i> Download PDF';
    }
}

// ═══════════════════════════════════════════
// HISTORY MANAGEMENT
// ═══════════════════════════════════════════
async function loadHistory() {
    try {
        allCertificates = await Storage.getAll();
        renderHistory(allCertificates);
        const clearBtn = document.getElementById("btnClearAll");
        clearBtn.style.display = allCertificates.length > 0 ? "inline-flex" : "none";
    } catch (err) {
        showToast("Failed to load history.", "error");
    }
}

function renderHistory(certs) {
    const tbody = document.getElementById("historyBody");
    const empty = document.getElementById("historyEmpty");
    document.getElementById("historyCount").textContent = certs.length + " record" + (certs.length !== 1 ? "s" : "");

    if (certs.length === 0) {
        tbody.innerHTML = "";
        empty.style.display = "block";
        return;
    }

    empty.style.display = "none";
    tbody.innerHTML = certs.map((c, index) => {
        const id = c._docId || c._localId;
        const certDataEncoded = encodeURIComponent(JSON.stringify(c));
        const isWinner = c.certFor === "winner";
        const typeBadge = isWinner
            ? `<span class="cert-type-badge winner"><i class="fas fa-trophy"></i> Winner</span>`
            : `<span class="cert-type-badge participant"><i class="fas fa-user-check"></i> Participant</span>`;

        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${escapeHtml(c.certId)}</strong></td>
                <td><span class="text-truncate">${escapeHtml(c.recipientName)}</span></td>
                <td><span class="text-truncate">${escapeHtml(c.workshopName || c.courseName || '')}</span></td>
                <td>${escapeHtml(c.institutionName || c.orgName || '-')}</td>
                <td>${formatDate(c.workshopDate || c.issueDate)}</td>
                <td>${typeBadge}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn btn-info btn-sm" onclick="viewCertificate('${certDataEncoded}')" title="View & Download">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteCert('${id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join("");
}

function searchCertificates() {
    const query = document.getElementById("searchInput").value.toLowerCase().trim();
    if (!query) {
        renderHistory(allCertificates);
        return;
    }

    const filtered = allCertificates.filter(c =>
        c.certId.toLowerCase().includes(query) ||
        c.recipientName.toLowerCase().includes(query) ||
        (c.workshopName || c.courseName || "").toLowerCase().includes(query) ||
        (c.institutionName || "").toLowerCase().includes(query) ||
        (c.workshopType || "").toLowerCase().includes(query) ||
        (c.certFor || "").toLowerCase().includes(query) ||
        (c.issuerName || "").toLowerCase().includes(query)
    );

    renderHistory(filtered);
}

async function deleteCert(id) {
    if (!confirm("Are you sure you want to delete this certificate record?")) return;
    try {
        await Storage.remove(id);
        showToast("Certificate record deleted.", "info");
        await loadHistory();
        await refreshData();
    } catch (err) {
        showToast("Delete failed: " + err.message, "error");
    }
}

async function clearAllCerts() {
    const count = allCertificates.length;
    if (!confirm(`⚠️ DELETE ALL ${count} certificate records?\n\nThis action CANNOT be undone!`)) return;
    if (!confirm(`Final confirmation: Delete all ${count} records?`)) return;

    try {
        await Storage.clearAll();
        showToast(`All ${count} certificate records deleted.`, "info");
        await loadHistory();
        await refreshData();
    } catch (err) {
        showToast("Failed to clear: " + err.message, "error");
    }
}

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
async function refreshData() {
    try {
        allCertificates = await Storage.getAll();
        const total = allCertificates.length;

        const todayStr = todayISO();
        const todayCount = allCertificates.filter(c => {
            return (c.workshopDate === todayStr || c.issueDate === todayStr) ||
                (c.createdAtLocal && c.createdAtLocal.startsWith(todayStr));
        }).length;

        document.getElementById("statTotal").textContent = total;
        document.getElementById("statToday").textContent = todayCount;
        document.getElementById("statDownloads").textContent = downloadCount;
        document.getElementById("historyBadge").textContent = total;

        const recent = allCertificates.slice(0, 5);
        const recentBody = document.getElementById("recentBody");
        const recentEmpty = document.getElementById("recentEmpty");

        if (recent.length === 0) {
            recentBody.innerHTML = "";
            recentEmpty.style.display = "block";
        } else {
            recentEmpty.style.display = "none";
            recentBody.innerHTML = recent.map(c => {
                const isWinner = c.certFor === "winner";
                const typeBadge = isWinner
                    ? `<span class="cert-type-badge winner"><i class="fas fa-trophy"></i> Winner</span>`
                    : `<span class="cert-type-badge participant"><i class="fas fa-user-check"></i> Participant</span>`;
                return `
                    <tr>
                        <td><strong>${escapeHtml(c.certId)}</strong></td>
                        <td>${escapeHtml(c.recipientName)}</td>
                        <td><span class="text-truncate">${escapeHtml(c.workshopName || c.courseName || '')}</span></td>
                        <td>${escapeHtml(c.institutionName || c.orgName || '-')}</td>
                        <td>${formatDate(c.workshopDate || c.issueDate)}</td>
                        <td>${typeBadge}</td>
                    </tr>
                `;
            }).join("");
        }
    } catch (err) {
        console.error("Dashboard refresh error:", err);
    }
}

// ═══════════════════════════════════════════
// FORM MANAGEMENT
// ═══════════════════════════════════════════
function clearForm() {
    document.getElementById("recipientName").value = "";
    document.getElementById("workshopType").value = "";
    document.getElementById("workshopName").value = "";
    document.getElementById("institutionName").value = "";
    document.getElementById("description").value = "";
    document.getElementById("workshopDate").value = todayISO();
    document.getElementById("issuerName").value = "";
    document.getElementById("issuerTitle").value = "Workshop Coordinator";
    document.getElementById("orgName").value = "Ellectra";
    document.getElementById("winnerPosition").value = "1st Place";

    selectCertFor("participant");
    selectTemplate("classic");
    updatePreview();
    showToast("Form cleared.", "info");
}

// ═══════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════
function generateCertId() {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0");
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    return `ELLEC-${dateStr}-${rand}`;
}

function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

function formatDate(dateStr) {
    if (!dateStr) return "-";
    try {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    } catch {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = {
        success: "check-circle",
        error: "exclamation-circle",
        info: "info-circle",
        warning: "exclamation-triangle"
    };

    toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("fade-out");
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 400);
    }, 4000);
}
