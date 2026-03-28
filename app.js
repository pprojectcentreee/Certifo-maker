/* ============================================
   CERTIFO MAKER — Application Logic
   Firebase Firestore + localStorage fallback
   ============================================ */

// ═══════════════════════════════════════════
//  FIREBASE CONFIGURATION (YOUR PROJECT)
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
//  DATABASE INITIALIZATION
// ═══════════════════════════════════════════
let db = null;
let useFirebase = false;

function initFirebase() {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();

        // Enable offline persistence
        db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            console.warn("Persistence error:", err.code);
        });

        useFirebase = true;
        console.log("✅ Firebase Firestore connected successfully!");
        updateDbBadge("firebase");
        return true;
    } catch (error) {
        console.error("❌ Firebase initialization failed:", error);
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
//  STORAGE ABSTRACTION LAYER
// ═══════════════════════════════════════════
const Storage = {

    // --- SAVE CERTIFICATE ---
    async save(certData) {
        if (useFirebase) {
            try {
                const docRef = await db.collection("certificates").add({
                    ...certData,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdAtLocal: new Date().toISOString()
                });
                console.log("📄 Saved to Firebase with ID:", docRef.id);
                return docRef.id;
            } catch (error) {
                console.error("Firebase save error, falling back to local:", error);
                return this._saveLocal(certData);
            }
        } else {
            return this._saveLocal(certData);
        }
    },

    _saveLocal(certData) {
        const certs = JSON.parse(localStorage.getItem("certifo_certs") || "[]");
        certData._localId = "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
        certData.createdAt = new Date().toISOString();
        certData.createdAtLocal = new Date().toISOString();
        certs.push(certData);
        localStorage.setItem("certifo_certs", JSON.stringify(certs));
        console.log("📄 Saved to localStorage with ID:", certData._localId);
        return certData._localId;
    },

    // --- GET ALL CERTIFICATES ---
    async getAll() {
        if (useFirebase) {
            try {
                const snapshot = await db.collection("certificates")
                    .orderBy("createdAt", "desc")
                    .get();
                return snapshot.docs.map(doc => ({
                    _docId: doc.id,
                    ...doc.data()
                }));
            } catch (error) {
                console.error("Firebase getAll error, falling back to local:", error);
                return this._getAllLocal();
            }
        } else {
            return this._getAllLocal();
        }
    },

    _getAllLocal() {
        const certs = JSON.parse(localStorage.getItem("certifo_certs") || "[]");
        return certs.reverse();
    },

    // --- DELETE CERTIFICATE ---
    async remove(id) {
        if (useFirebase) {
            try {
                await db.collection("certificates").doc(id).delete();
                console.log("🗑️ Deleted from Firebase:", id);
            } catch (error) {
                console.error("Firebase delete error:", error);
                this._removeLocal(id);
            }
        } else {
            this._removeLocal(id);
        }
    },

    _removeLocal(id) {
        let certs = JSON.parse(localStorage.getItem("certifo_certs") || "[]");
        certs = certs.filter(c => c._localId !== id);
        localStorage.setItem("certifo_certs", JSON.stringify(certs));
        console.log("🗑️ Deleted from localStorage:", id);
    },

    // --- CLEAR ALL ---
    async clearAll() {
        if (useFirebase) {
            try {
                const snapshot = await db.collection("certificates").get();
                const batch = db.batch();
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                console.log("🗑️ All certificates deleted from Firebase");
            } catch (error) {
                console.error("Firebase clearAll error:", error);
                localStorage.removeItem("certifo_certs");
            }
        } else {
            localStorage.removeItem("certifo_certs");
            console.log("🗑️ All certificates deleted from localStorage");
        }
    },

    // --- COUNT ---
    async count() {
        const all = await this.getAll();
        return all.length;
    }
};

// ═══════════════════════════════════════════
//  APPLICATION STATE
// ═══════════════════════════════════════════
let currentTemplate = "classic";
let allCertificates = [];
let downloadCount = parseInt(localStorage.getItem("certifo_downloads") || "0");
let currentViewCert = null;

// ═══════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {

    // Initialize Firebase
    const fbReady = initFirebase();

    // Set default date to today
    document.getElementById("issueDate").value = todayISO();

    // Initial preview update
    updatePreview();

    // Scale certificate preview
    scalePreview();
    window.addEventListener("resize", scalePreview);

    // Nav toggle (mobile)
    document.getElementById("navToggle").addEventListener("click", () => {
        document.getElementById("navLinks").classList.toggle("open");
    });

    // Nav links
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            showSection(link.dataset.section);
            document.getElementById("navLinks").classList.remove("open");
        });
    });

    // Close modal on overlay click
    document.getElementById("modalOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Close modal on Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
    });

    // Load initial data
    await refreshData();

    // Hide loading screen
    setTimeout(() => {
        document.getElementById("loading-screen").classList.add("hidden");
    }, 1200);

    console.log("🏆 Certifo Maker initialized successfully!");
    console.log("📦 Database:", useFirebase ? "Firebase Firestore" : "localStorage");
});

// ═══════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════
function showSection(name) {
    // Hide all sections
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));

    // Show target section
    document.getElementById("section-" + name).classList.add("active");
    document.querySelector(`.nav-link[data-section="${name}"]`).classList.add("active");

    // Section-specific actions
    if (name === "history") loadHistory();
    if (name === "dashboard") refreshData();
    if (name === "create") {
        setTimeout(scalePreview, 150);
        updatePreview();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════
//  TEMPLATE SELECTION
// ═══════════════════════════════════════════
function selectTemplate(name) {
    currentTemplate = name;

    // Update UI
    document.querySelectorAll(".template-option").forEach(o => o.classList.remove("active"));
    document.querySelector(`.template-option[data-template="${name}"]`).classList.add("active");

    // Update certificate class
    const cert = document.getElementById("certificatePreview");
    cert.className = "certificate template-" + name;

    updatePreview();
}

// ═══════════════════════════════════════════
//  LIVE PREVIEW
// ═══════════════════════════════════════════
function updatePreview() {
    const recipientName = document.getElementById("recipientName").value || "Recipient Name";
    const courseName = document.getElementById("courseName").value || "Course / Program Name";
    const description = document.getElementById("description").value || "";
    const issueDate = document.getElementById("issueDate").value;
    const issuerName = document.getElementById("issuerName").value || "Issuer Name";
    const issuerTitle = document.getElementById("issuerTitle").value || "Authorized Signatory";
    const orgName = document.getElementById("orgName").value || "Your Organization";
    const certType = document.getElementById("certType").value;

    document.getElementById("prevName").textContent = recipientName;
    document.getElementById("prevCourse").textContent = courseName;
    document.getElementById("prevDesc").textContent = description;
    document.getElementById("prevIssuer").textContent = issuerName;
    document.getElementById("prevIssuerTitle").textContent = issuerTitle;
    document.getElementById("prevOrg").textContent = orgName;
    document.getElementById("prevType").textContent = "OF " + certType.toUpperCase();
    document.getElementById("prevDate").textContent = issueDate ? formatDate(issueDate) : "Date";
    document.getElementById("prevId").textContent = "ID: " + generateCertId();
}

// ═══════════════════════════════════════════
//  PREVIEW SCALING (Responsive)
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
//  GENERATE PDF & SAVE TO DATABASE
// ═══════════════════════════════════════════
async function generateAndSave() {
    // Validation
    const recipientName = document.getElementById("recipientName").value.trim();
    const courseName = document.getElementById("courseName").value.trim();
    const issueDate = document.getElementById("issueDate").value;
    const issuerName = document.getElementById("issuerName").value.trim();
    const orgName = document.getElementById("orgName").value.trim();

    const errors = [];
    if (!recipientName) errors.push("Recipient Name");
    if (!courseName) errors.push("Course / Program");
    if (!issueDate) errors.push("Issue Date");
    if (!issuerName) errors.push("Issuer Name");
    if (!orgName) errors.push("Organization");

    if (errors.length > 0) {
        showToast(`Please fill: ${errors.join(", ")}`, "error");
        return;
    }

    // UI feedback
    const btn = document.getElementById("btnGenerate");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating PDF...';

    try {
        const certId = generateCertId();
        const certType = document.getElementById("certType").value;
        const description = document.getElementById("description").value.trim();
        const issuerTitle = document.getElementById("issuerTitle").value.trim() || "Authorized Signatory";

        // Update preview with final cert ID
        document.getElementById("prevId").textContent = "ID: " + certId;

        // Wait a frame for DOM update
        await delay(100);

        // Build certificate data
        const certData = {
            certId,
            recipientName,
            courseName,
            description,
            issueDate,
            issuerName,
            issuerTitle,
            orgName,
            certType,
            template: currentTemplate
        };

        // 1. Save to database
        showToast("Saving to database...", "info");
        const savedId = await Storage.save(certData);

        // 2. Generate & download PDF
        showToast("Generating PDF...", "info");
        await generatePDF(certId, recipientName);

        // 3. Update download count
        downloadCount++;
        localStorage.setItem("certifo_downloads", downloadCount.toString());

        // 4. Success!
        showToast(`✅ Certificate "${certId}" saved & PDF downloaded!`, "success");

        // 5. Refresh data
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
//  PDF GENERATION ENGINE
// ═══════════════════════════════════════════
async function generatePDF(certId, recipientName) {
    const cert = document.getElementById("certificatePreview");
    const scaler = document.getElementById("previewScaler");
    const container = document.getElementById("previewContainer");

    // Save current state
    const savedTransform = scaler.style.transform;
    const savedHeight = container.style.height;

    // Set to full size for high-quality capture
    scaler.style.transform = "scale(1)";
    container.style.height = "auto";
    container.style.overflow = "visible";

    // Wait for fonts and rendering
    await document.fonts.ready;
    await delay(500);

    // Capture certificate as canvas
    const canvas = await html2canvas(cert, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: null,
        width: 800,
        height: 566,
        windowWidth: 800,
        windowHeight: 566
    });

    // Restore original state
    scaler.style.transform = savedTransform;
    container.style.height = savedHeight;
    container.style.overflow = "auto";

    // Generate PDF
    const imgData = canvas.toDataURL("image/png", 1.0);
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4"
    });

    const pageW = pdf.internal.pageSize.getWidth();   // 297mm
    const pageH = pdf.internal.pageSize.getHeight();   // 210mm
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

    // Set PDF metadata
    pdf.setProperties({
        title: `Certificate - ${recipientName}`,
        subject: `Certificate ID: ${certId}`,
        author: "Certifo Maker",
        creator: "Certifo Maker"
    });

    // Download PDF
    const filename = `${certId}_${recipientName.replace(/\s+/g, "_")}.pdf`;
    pdf.save(filename);

    return filename;
}

// ═══════════════════════════════════════════
//  VIEW & REDOWNLOAD CERTIFICATE
// ═══════════════════════════════════════════
function viewCertificate(certDataJSON) {
    const certData = JSON.parse(decodeURIComponent(certDataJSON));
    currentViewCert = certData;

    // Build certificate HTML in modal
    const modalScaler = document.getElementById("modalPreviewScaler");

    modalScaler.innerHTML = `
        <div class="certificate template-${certData.template}" id="modalCertificate">
            <div class="cert-watermark">★</div>
            <div class="cert-outer">
                <div class="cert-inner">
                    <div class="cert-corner cert-tl">❖</div>
                    <div class="cert-corner cert-tr">❖</div>
                    <div class="cert-corner cert-bl">❖</div>
                    <div class="cert-corner cert-br">❖</div>

                    <div class="cert-header">
                        <div class="cert-org-name">${escapeHtml(certData.orgName || 'Organization')}</div>
                        <div class="cert-star">★</div>
                        <h1 class="cert-title">CERTIFICATE</h1>
                        <div class="cert-of">OF ${(certData.certType || 'Achievement').toUpperCase()}</div>
                        <div class="cert-line-deco">
                            <span class="line-side"></span>
                            <span class="line-diamond">◆</span>
                            <span class="line-side"></span>
                        </div>
                    </div>

                    <div class="cert-body">
                        <p class="cert-presented">This certificate is proudly presented to</p>
                        <h2 class="cert-recipient">${escapeHtml(certData.recipientName)}</h2>
                        <div class="cert-underline"></div>
                        <p class="cert-for">for successfully completing</p>
                        <h3 class="cert-course">${escapeHtml(certData.courseName)}</h3>
                        <p class="cert-desc">${escapeHtml(certData.description || '')}</p>
                    </div>

                    <div class="cert-footer">
                        <div class="cert-sign-block">
                            <div class="cert-sign-line"></div>
                            <p class="cert-sign-name">${escapeHtml(certData.issuerName)}</p>
                            <p class="cert-sign-role">${escapeHtml(certData.issuerTitle || 'Authorized Signatory')}</p>
                        </div>
                        <div class="cert-seal-block">
                            <div class="cert-seal">
                                <div class="cert-seal-inner">★</div>
                            </div>
                        </div>
                        <div class="cert-date-block">
                            <div class="cert-sign-line"></div>
                            <p class="cert-date-val">${formatDate(certData.issueDate)}</p>
                            <p class="cert-sign-role">Date of Issue</p>
                        </div>
                    </div>

                    <div class="cert-id">ID: ${certData.certId}</div>
                </div>
            </div>
        </div>
    `;

    // Scale modal certificate
    const modalContainer = document.getElementById("modalPreviewContainer");
    setTimeout(() => {
        const availableWidth = modalContainer.clientWidth - 30;
        const scale = Math.min(1, availableWidth / 800);
        modalScaler.style.transform = `scale(${scale})`;
        modalScaler.style.transformOrigin = "top center";
        modalContainer.style.height = (566 * scale + 30) + "px";
    }, 100);

    // Show modal
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

        // Set full size
        const savedTransform = modalScaler.style.transform;
        modalScaler.style.transform = "scale(1)";

        await document.fonts.ready;
        await delay(400);

        const canvas = await html2canvas(cert, {
            scale: 3,
            useCORS: true,
            logging: false,
            backgroundColor: null,
            width: 800,
            height: 566
        });

        // Restore
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
            title: `Certificate - ${currentViewCert.recipientName}`,
            subject: `Certificate ID: ${currentViewCert.certId}`,
            author: "Certifo Maker"
        });

        pdf.save(`${currentViewCert.certId}_${currentViewCert.recipientName.replace(/\s+/g, "_")}.pdf`);

        downloadCount++;
        localStorage.setItem("certifo_downloads", downloadCount.toString());

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
//  HISTORY MANAGEMENT
// ═══════════════════════════════════════════
async function loadHistory() {
    try {
        allCertificates = await Storage.getAll();
        renderHistory(allCertificates);

        // Show/hide clear all button
        const clearBtn = document.getElementById("btnClearAll");
        clearBtn.style.display = allCertificates.length > 0 ? "inline-flex" : "none";

    } catch (err) {
        console.error("History load error:", err);
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

        return `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(c.certId)}</strong></td>
            <td><span class="text-truncate">${escapeHtml(c.recipientName)}</span></td>
            <td><span class="text-truncate">${escapeHtml(c.courseName)}</span></td>
            <td>${escapeHtml(c.orgName || '-')}</td>
            <td>${formatDate(c.issueDate)}</td>
            <td><span class="template-badge ${c.template}">${c.template}</span></td>
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
        c.courseName.toLowerCase().includes(query) ||
        (c.orgName || "").toLowerCase().includes(query) ||
        (c.certType || "").toLowerCase().includes(query) ||
        (c.issuerName || "").toLowerCase().includes(query)
    );

    renderHistory(filtered);
}

async function deleteCert(id) {
    if (!confirm("Are you sure you want to delete this certificate record?\n\nThis action cannot be undone.")) return;

    try {
        await Storage.remove(id);
        showToast("Certificate record deleted.", "info");
        await loadHistory();
        await refreshData();
    } catch (err) {
        console.error("Delete error:", err);
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
        console.error("Clear all error:", err);
        showToast("Failed to clear: " + err.message, "error");
    }
}

// ═══════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════
async function refreshData() {
    try {
        allCertificates = await Storage.getAll();
        const total = allCertificates.length;

        // Count certificates created today
        const todayStr = todayISO();
        const todayCount = allCertificates.filter(c => {
            return (c.issueDate === todayStr) ||
                   (c.createdAtLocal && c.createdAtLocal.startsWith(todayStr));
        }).length;

        // Update stats
        document.getElementById("statTotal").textContent = total;
        document.getElementById("statToday").textContent = todayCount;
        document.getElementById("statDownloads").textContent = downloadCount;
        document.getElementById("historyBadge").textContent = total;

        // Recent certificates table (last 5)
        const recent = allCertificates.slice(0, 5);
        const recentBody = document.getElementById("recentBody");
        const recentEmpty = document.getElementById("recentEmpty");

        if (recent.length === 0) {
            recentBody.innerHTML = "";
            recentEmpty.style.display = "block";
        } else {
            recentEmpty.style.display = "none";
            recentBody.innerHTML = recent.map(c => `
                <tr>
                    <td><strong>${escapeHtml(c.certId)}</strong></td>
                    <td>${escapeHtml(c.recipientName)}</td>
                    <td><span class="text-truncate">${escapeHtml(c.courseName)}</span></td>
                    <td>${escapeHtml(c.orgName || '-')}</td>
                    <td>${formatDate(c.issueDate)}</td>
                    <td><span class="template-badge ${c.template}">${c.template}</span></td>
                </tr>
            `).join("");
        }
    } catch (err) {
        console.error("Dashboard refresh error:", err);
    }
}

// ═══════════════════════════════════════════
//  FORM MANAGEMENT
// ═══════════════════════════════════════════
function clearForm() {
    document.getElementById("recipientName").value = "";
    document.getElementById("courseName").value = "";
    document.getElementById("description").value = "";
    document.getElementById("issueDate").value = todayISO();
    document.getElementById("issuerName").value = "";
    document.getElementById("issuerTitle").value = "Authorized Signatory";
    document.getElementById("orgName").value = "";
    document.getElementById("certType").value = "Achievement";

    selectTemplate("classic");
    updatePreview();

    showToast("Form cleared.", "info");
}

// ═══════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════
function generateCertId() {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0");
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    return `CERT-${dateStr}-${rand}`;
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

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.classList.add("fade-out");
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 400);
    }, 4000);
}
