// Variáveis de Estado Global
        const State = {
            activeTool: 'pencil',
            brushSize: 1,
            currentColor: '#3b82f6',
            secondaryColor: '#1e293b',
            modelType: 'classic', // classic | slim
            palette: [
                '#000000', '#ffffff', '#795548', '#f44336', 
                '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', 
                '#2196f3', '#03a9f4', '#00bcd4', '#009688', 
                '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', 
                '#ffc107', '#ff9800', '#ff5722', '#607d8b'
            ],
            layers: [],
            activeLayerIndex: 0,
            history: [],
            historyIndex: -1,
            gridVisible: true,
            zoom: 1,
            selectedStamp: null,
            lineStart: null,
            is3DPainting: false,
            templateVisible: false, // Estado do template
            shapeFilled: false, // Retângulo/Círculo preenchidos ou apenas contorno
            symmetryMode: 'off', // off | h | v | both | uv
            recentColors: [],
            favoriteColors: [],
            savedPalettes: {}, // { nome: [hex, hex, ...] }
            currentProjectName: 'Projeto sem título',
            currentProjectId: null, // null = ainda não salvo como projeto nomeado
            currentAnimation: 'none',
            collageObjects: [], // { id, img, x, y, w, h, rotation, opacity, brightness, contrast, saturation, flipH, flipV, pixelize, pixelSize, removeBg, removeBgColor, removeBgTolerance }
            selectedCollageId: null,
            faceSelectMode: false,
            shadingLightDir: 'top',
            shadingIntensity: 35,
            hasUnsavedChanges: false
        };

        let isPainting = false;
        let isPanning2D = false;
        let panX = 0, panY = 0;
        let startPanX = 0, startPanY = 0;

        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xl border backdrop-blur flex items-center gap-2 transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto bg-slate-900/90 text-slate-100 border-slate-700`;
            
            let icon = '<i class="fa-solid fa-circle-info text-blue-400"></i>';
            if (type === 'success') icon = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
            if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation text-amber-400"></i>';
            
            toast.innerHTML = `${icon} <span>${message}</span>`;
            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.remove('translate-y-2', 'opacity-0');
            }, 10);

            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-y-2');
                setTimeout(() => toast.remove(), 300);
            }, 2500);
        }

        // --- TOOLTIP DO EDITOR UV (Seção 12) — usado tanto no hover do 2D quanto do 3D ---
        function showUvTooltip(x, y, clientX, clientY) {
            const tooltip = document.getElementById('uv-hover-tooltip');
            if (!tooltip) return;
            const region = REGIONS_INFO.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
            const face = findFaceAtPixel(x, y);
            const activeLayer = State.layers[State.activeLayerIndex];

            const lines = [
                `<div class="font-bold text-cyan-300">${region ? region.label : 'Fora da textura'}</div>`,
                face ? `<div class="text-slate-400">Face: ${FACE_LABELS[face.faceKey]}</div>` : '',
                `<div class="text-slate-400">Coords: ${x}, ${y}</div>`,
                face ? `<div class="text-slate-400">Tamanho: ${face.rect.w}×${face.rect.h}px</div>` : '',
                activeLayer ? `<div class="text-slate-500">Camada: ${activeLayer.name}</div>` : ''
            ].filter(Boolean).join('');

            tooltip.innerHTML = lines;
            const left = Math.min(clientX + 14, window.innerWidth - 180);
            const top = Math.min(clientY + 14, window.innerHeight - 90);
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.classList.remove('hidden');
        }
        function hideUvTooltip() {
            document.getElementById('uv-hover-tooltip')?.classList.add('hidden');
        }

        let dbInstance = null;
        function initIndexedDB() {
            return new Promise((resolve) => {
                try {
                    const request = indexedDB.open('MinecraftSkinStudioDBPro', 3);
                    request.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('project_store')) {
                            db.createObjectStore('project_store', { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('projects')) {
                            db.createObjectStore('projects', { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('versions')) {
                            db.createObjectStore('versions', { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('elements')) {
                            db.createObjectStore('elements', { keyPath: 'id' });
                        }
                    };
                    request.onsuccess = (e) => {
                        dbInstance = e.target.result;
                        resolve(true);
                    };
                    request.onerror = () => resolve(false);
                } catch(err) {
                    resolve(false);
                }
            });
        }

        // Serializa as camadas atuais para um formato leve e persistível (PNG base64 por camada).
        function serializeCurrentLayers() {
            return State.layers.map(l => ({
                id: l.id,
                name: l.name,
                visible: l.visible,
                locked: l.locked,
                opacity: l.opacity !== undefined ? l.opacity : 1,
                dataUrl: l.canvas.toDataURL('image/png')
            }));
        }

        // Reconstrói State.layers a partir de camadas serializadas (usado por versões e projetos).
        function deserializeLayers(layersData) {
            return new Promise((resolve) => {
                if (!layersData || layersData.length === 0) { resolve([]); return; }
                let loadedCount = 0;
                const loadedLayers = [];
                layersData.forEach((item, index) => {
                    const img = new Image();
                    img.onload = () => {
                        const layerObj = createLayerObject(item.name);
                        layerObj.id = item.id || layerObj.id;
                        layerObj.visible = item.visible !== undefined ? item.visible : true;
                        layerObj.locked = item.locked || false;
                        layerObj.opacity = item.opacity !== undefined ? item.opacity : 1;
                        layerObj.ctx.drawImage(img, 0, 0);
                        loadedLayers[index] = layerObj;
                        loadedCount++;
                        if (loadedCount === layersData.length) resolve(loadedLayers);
                    };
                    img.src = item.dataUrl;
                });
            });
        }

        // Gera uma miniatura (dataURL) da composição atual de todas as camadas visíveis.
        function generateThumbnail(size = 64) {
            const tmp = document.createElement('canvas');
            tmp.width = size; tmp.height = size;
            const tctx = tmp.getContext('2d');
            tctx.imageSmoothingEnabled = false;
            State.layers.forEach(l => {
                if (!l.visible) return;
                tctx.globalAlpha = l.opacity !== undefined ? l.opacity : 1;
                tctx.drawImage(l.canvas, 0, 0, size, size);
            });
            tctx.globalAlpha = 1;
            return tmp.toDataURL('image/png');
        }

        // --- Wrappers genéricos de IndexedDB (Promise-based) para os stores 'projects' e 'versions' ---
        function idbPut(storeName, obj) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve(false); return; }
                try {
                    const tx = dbInstance.transaction(storeName, 'readwrite');
                    tx.objectStore(storeName).put(obj);
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (e) { resolve(false); }
            });
        }
        function idbGetAll(storeName) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve([]); return; }
                try {
                    const tx = dbInstance.transaction(storeName, 'readonly');
                    const req = tx.objectStore(storeName).getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                } catch (e) { resolve([]); }
            });
        }
        function idbGet(storeName, id) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve(null); return; }
                try {
                    const tx = dbInstance.transaction(storeName, 'readonly');
                    const req = tx.objectStore(storeName).get(id);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                } catch (e) { resolve(null); }
            });
        }
        function idbDelete(storeName, id) {
            return new Promise((resolve) => {
                if (!dbInstance) { resolve(false); return; }
                try {
                    const tx = dbInstance.transaction(storeName, 'readwrite');
                    tx.objectStore(storeName).delete(id);
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (e) { resolve(false); }
            });
        }
        function newId(prefix) {
            return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }

        // --- PROJETOS (múltiplos projetos nomeados, além do autosave contínuo) ---
        function updateProjectLabel() {
            const headerLabel = document.getElementById('label-current-project');
            if (headerLabel) headerLabel.textContent = State.currentProjectName;
            const modalLabel = document.getElementById('current-project-label');
            if (modalLabel) modalLabel.textContent = State.currentProjectName;
        }

        async function refreshProjectsList() {
            const listEl = document.getElementById('projects-list');
            if (!listEl) return;
            const projects = await idbGetAll('projects');
            projects.sort((a, b) => b.updatedAt - a.updatedAt);
            listEl.innerHTML = '';
            if (projects.length === 0) {
                listEl.innerHTML = '<span class="text-[11px] text-slate-600 italic px-1">Nenhum projeto salvo ainda</span>';
                return;
            }
            projects.forEach(p => {
                const row = document.createElement('div');
                row.className = `flex items-center gap-2 p-2 rounded-xl border ${p.id === State.currentProjectId ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 bg-slate-950/40'}`;

                const thumb = document.createElement('img');
                thumb.src = p.thumbnail;
                thumb.className = 'w-9 h-9 rounded-lg checkerboard border border-slate-700 shrink-0';
                thumb.style.imageRendering = 'pixelated';

                const info = document.createElement('div');
                info.className = 'flex-1 min-w-0 cursor-pointer';
                info.innerHTML = `<span class="text-xs font-semibold text-slate-200 truncate block">${p.name}</span><span class="text-[10px] text-slate-500">${new Date(p.updatedAt).toLocaleString('pt-BR')}</span>`;
                info.addEventListener('click', () => openProject(p.id));

                const actions = document.createElement('div');
                actions.className = 'flex items-center gap-1 shrink-0';
                actions.innerHTML = `
                    <button class="p-btn-dup p-1 text-slate-400 hover:text-emerald-400" title="Duplicar"><i class="fa-solid fa-clone text-xs"></i></button>
                    <button class="p-btn-ren p-1 text-slate-400 hover:text-blue-400" title="Renomear"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button class="p-btn-del p-1 text-slate-500 hover:text-red-400" title="Excluir"><i class="fa-solid fa-trash text-xs"></i></button>`;

                actions.querySelector('.p-btn-dup').addEventListener('click', async (e) => { e.stopPropagation(); await duplicateProject(p); });
                actions.querySelector('.p-btn-ren').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showRenameModal(p.name, async (name) => {
                        p.name = name; p.updatedAt = Date.now();
                        await idbPut('projects', p);
                        if (p.id === State.currentProjectId) { State.currentProjectName = name; updateProjectLabel(); }
                        refreshProjectsList();
                    });
                });
                actions.querySelector('.p-btn-del').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showConfirmModal('Excluir projeto', `Excluir "${p.name}" permanentemente? Essa ação não pode ser desfeita.`, async () => {
                        await idbDelete('projects', p.id);
                        refreshProjectsList();
                        showToast('Projeto excluído', 'info');
                    }, { confirmLabel: 'Excluir' });
                });

                row.appendChild(thumb); row.appendChild(info); row.appendChild(actions);
                listEl.appendChild(row);
            });
        }

        async function saveProjectAs(name) {
            const id = newId('proj');
            const payload = {
                id, name,
                layers: serializeCurrentLayers(),
                activeLayerIndex: State.activeLayerIndex,
                modelType: State.modelType,
                thumbnail: generateThumbnail(64),
                createdAt: Date.now(), updatedAt: Date.now()
            };
            await idbPut('projects', payload);
            State.currentProjectId = id;
            State.currentProjectName = name;
            updateProjectLabel();
            refreshProjectsList();
            markChangesSaved();
            showToast(`Projeto "${name}" salvo`, 'success');
        }

        async function openProject(id) {
            const data = await idbGet('projects', id);
            if (!data) return;
            showConfirmModal(
                'Abrir projeto',
                `Abrir "${data.name}"? Qualquer alteração não salva no projeto atual será perdida.`,
                async () => {
                    const layers = await deserializeLayers(data.layers);
                    State.layers = layers;
                    State.activeLayerIndex = Math.min(data.activeLayerIndex || 0, layers.length - 1);
                    State.currentProjectId = data.id;
                    State.currentProjectName = data.name;
                    updateProjectLabel();
                    renderLayerUI();
                    render2DCanvas();
                    saveHistoryState();
                    markChangesSaved();
                    closeAllModals();
                    showToast(`Projeto "${data.name}" aberto`, 'success');
                },
                { confirmLabel: 'Abrir', danger: false }
            );
        }

        async function duplicateProject(p) {
            const copy = { ...p, id: newId('proj'), name: `${p.name} (Cópia)`, createdAt: Date.now(), updatedAt: Date.now() };
            await idbPut('projects', copy);
            refreshProjectsList();
            showToast(`Projeto duplicado como "${copy.name}"`, 'success');
        }

        document.getElementById('btn-open-projects')?.addEventListener('click', () => { openModal('modal-projects'); refreshProjectsList(); });
        document.getElementById('btn-project-save-as')?.addEventListener('click', () => {
            showRenameModal(State.currentProjectName, (name) => saveProjectAs(name));
        });
        document.getElementById('btn-project-new')?.addEventListener('click', () => {
            showConfirmModal('Novo projeto', 'Iniciar um projeto em branco? As alterações não salvas serão perdidas.', () => {
                State.currentProjectId = null;
                State.currentProjectName = 'Projeto sem título';
                updateProjectLabel();
                initLayers();
                markChangesSaved();
                closeAllModals();
            }, { confirmLabel: 'Criar Novo' });
        });

        // --- VERSÕES (linha do tempo de snapshots manuais) ---
        async function refreshVersionsList() {
            const listEl = document.getElementById('versions-list');
            if (!listEl) return;
            const versions = await idbGetAll('versions');
            versions.sort((a, b) => b.createdAt - a.createdAt);
            listEl.innerHTML = '';
            if (versions.length === 0) {
                listEl.innerHTML = '<span class="text-[11px] text-slate-600 italic px-1">Nenhuma versão salva ainda</span>';
                return;
            }
            versions.forEach(v => {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-2 p-2 rounded-xl border border-slate-800 bg-slate-950/40';

                const thumb = document.createElement('img');
                thumb.src = v.thumbnail;
                thumb.className = 'w-9 h-9 rounded-lg checkerboard border border-slate-700 shrink-0';
                thumb.style.imageRendering = 'pixelated';

                const info = document.createElement('div');
                info.className = 'flex-1 min-w-0';
                info.innerHTML = `<span class="text-xs font-semibold text-slate-200 truncate block">${v.label}</span><span class="text-[10px] text-slate-500">${new Date(v.createdAt).toLocaleString('pt-BR')}</span>`;

                const actions = document.createElement('div');
                actions.className = 'flex items-center gap-1 shrink-0';
                actions.innerHTML = `
                    <button class="v-btn-cmp p-1 text-slate-400 hover:text-sky-400" title="Comparar com atual"><i class="fa-solid fa-code-compare text-xs"></i></button>
                    <button class="v-btn-dup p-1 text-slate-400 hover:text-emerald-400" title="Duplicar"><i class="fa-solid fa-clone text-xs"></i></button>
                    <button class="v-btn-res p-1 text-slate-400 hover:text-amber-400" title="Restaurar"><i class="fa-solid fa-clock-rotate-left text-xs"></i></button>
                    <button class="v-btn-del p-1 text-slate-500 hover:text-red-400" title="Excluir"><i class="fa-solid fa-trash text-xs"></i></button>`;

                actions.querySelector('.v-btn-cmp').addEventListener('click', () => openCompareModal(v));
                actions.querySelector('.v-btn-dup').addEventListener('click', async () => {
                    const copy = { ...v, id: newId('ver'), label: `${v.label} (Cópia)`, createdAt: Date.now() };
                    await idbPut('versions', copy);
                    refreshVersionsList();
                    showToast('Versão duplicada', 'success');
                });
                actions.querySelector('.v-btn-res').addEventListener('click', () => {
                    showConfirmModal('Restaurar versão', `Restaurar "${v.label}"? O estado atual não salvo será perdido.`, async () => {
                        const layers = await deserializeLayers(v.layers);
                        State.layers = layers;
                        State.activeLayerIndex = Math.min(v.activeLayerIndex || 0, layers.length - 1);
                        renderLayerUI();
                        render2DCanvas();
                        saveHistoryState();
                        closeAllModals();
                        showToast(`Versão "${v.label}" restaurada`, 'success');
                    }, { confirmLabel: 'Restaurar' });
                });
                actions.querySelector('.v-btn-del').addEventListener('click', () => {
                    showConfirmModal('Excluir versão', `Excluir "${v.label}" permanentemente?`, async () => {
                        await idbDelete('versions', v.id);
                        refreshVersionsList();
                        showToast('Versão excluída', 'info');
                    }, { confirmLabel: 'Excluir' });
                });

                row.appendChild(thumb); row.appendChild(info); row.appendChild(actions);
                listEl.appendChild(row);
            });
        }

        async function saveVersion(label) {
            const payload = {
                id: newId('ver'), label,
                layers: serializeCurrentLayers(),
                activeLayerIndex: State.activeLayerIndex,
                thumbnail: generateThumbnail(64),
                createdAt: Date.now()
            };
            await idbPut('versions', payload);
            refreshVersionsList();
            showToast(`Versão "${label}" salva`, 'success');
        }

        document.getElementById('btn-open-versions')?.addEventListener('click', () => { openModal('modal-versions'); refreshVersionsList(); });
        document.getElementById('btn-save-version')?.addEventListener('click', () => {
            const defaultLabel = `Versão ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
            showRenameModal(defaultLabel, (label) => saveVersion(label));
        });

        // --- COMPARAÇÃO (Original vs Atual + mapa de diferenças) ---
        function compositeLayersToCanvas(layers, size) {
            const tmp = document.createElement('canvas');
            tmp.width = size; tmp.height = size;
            const tctx = tmp.getContext('2d');
            tctx.imageSmoothingEnabled = false;
            layers.forEach(l => {
                if (!l.visible) return;
                tctx.globalAlpha = l.opacity !== undefined ? l.opacity : 1;
                tctx.drawImage(l.canvas, 0, 0, size, size);
            });
            tctx.globalAlpha = 1;
            return tmp;
        }
        function drawScaledToCanvas(sourceCanvas, targetCanvas) {
            const tctx = targetCanvas.getContext('2d');
            tctx.imageSmoothingEnabled = false;
            tctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            tctx.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
        }
        function computeDiffCanvas(canvasA, canvasB) {
            const w = 64, h = 64;
            const dataA = canvasA.getContext('2d').getImageData(0, 0, w, h);
            const dataB = canvasB.getContext('2d').getImageData(0, 0, w, h);
            const out = document.createElement('canvas');
            out.width = w; out.height = h;
            const octx = out.getContext('2d');
            const outImg = octx.createImageData(w, h);
            let diffCount = 0;
            for (let i = 0; i < dataA.data.length; i += 4) {
                const same = dataA.data[i] === dataB.data[i] && dataA.data[i+1] === dataB.data[i+1] &&
                             dataA.data[i+2] === dataB.data[i+2] && dataA.data[i+3] === dataB.data[i+3];
                if (!same) {
                    outImg.data[i] = 239; outImg.data[i+1] = 68; outImg.data[i+2] = 68; outImg.data[i+3] = 220;
                    diffCount++;
                }
            }
            octx.putImageData(outImg, 0, 0);
            out.diffCount = diffCount;
            return out;
        }

        async function openCompareModal(version) {
            openModal('modal-compare');
            document.getElementById('compare-label-a').textContent = version.label;

            const layersA = await deserializeLayers(version.layers);
            const canvasA = compositeLayersToCanvas(layersA, 64);
            const canvasB = compositeLayersToCanvas(State.layers, 64);

            drawScaledToCanvas(canvasA, document.getElementById('compare-canvas-a'));
            drawScaledToCanvas(canvasB, document.getElementById('compare-canvas-b'));

            const diffCanvas = computeDiffCanvas(canvasA, canvasB);
            drawScaledToCanvas(diffCanvas, document.getElementById('compare-canvas-diff'));

            document.getElementById('compare-diff-summary').textContent = `${diffCanvas.diffCount} de 4096 pixels diferentes (${Math.round(diffCanvas.diffCount / 40.96)}%)`;
        }

        async function saveToBrowserStorage() {
            if (!dbInstance) return;
            try {
                const layersData = State.layers.map(l => ({
                    id: l.id,
                    name: l.name,
                    visible: l.visible,
                    locked: l.locked,
                    opacity: l.opacity !== undefined ? l.opacity : 1,
                    dataUrl: l.canvas.toDataURL('image/png')
                }));

                const payload = {
                    id: 'saved_skin_project',
                    layers: layersData,
                    activeLayerIndex: State.activeLayerIndex,
                    updatedAt: Date.now()
                };

                const tx = dbInstance.transaction('project_store', 'readwrite');
                tx.objectStore('project_store').put(payload);
                
                const statusEl = document.getElementById('status-storage-saved');
                if (statusEl) {
                    statusEl.textContent = "Guardado";
                    statusEl.className = "text-[10px] text-emerald-400 font-semibold";
                }
            } catch (err) {
                console.error("Erro ao guardar:", err);
            }
        }

        async function loadFromBrowserStorage() {
            if (!dbInstance) return false;
            return new Promise((resolve) => {
                try {
                    const tx = dbInstance.transaction('project_store', 'readonly');
                    const req = tx.objectStore('project_store').get('saved_skin_project');
                    req.onsuccess = () => {
                        const data = req.result;
                        if (!data || !data.layers || data.layers.length === 0) {
                            resolve(false);
                            return;
                        }

                        let loadedCount = 0;
                        const loadedLayers = [];

                        data.layers.forEach((item, index) => {
                            const img = new Image();
                            img.onload = () => {
                                const layerObj = createLayerObject(item.name);
                                layerObj.id = item.id || layerObj.id;
                                layerObj.visible = item.visible !== undefined ? item.visible : true;
                                layerObj.locked = item.locked || false;
                                layerObj.opacity = item.opacity !== undefined ? item.opacity : 1;
                                layerObj.ctx.drawImage(img, 0, 0);

                                loadedLayers[index] = layerObj;
                                loadedCount++;

                                if (loadedCount === data.layers.length) {
                                    State.layers = loadedLayers;
                                    State.activeLayerIndex = Math.min(data.activeLayerIndex || 0, State.layers.length - 1);
                                    renderLayerUI();
                                    render2DCanvas();
                                    saveHistoryState();
                                    showToast('Projeto restaurado automaticamente!', 'success');
                                    resolve(true);
                                }
                            };
                            img.src = item.dataUrl;
                        });
                    };
                    req.onerror = () => resolve(false);
                } catch(e) {
                    resolve(false);
                }
            });
        }

        const canvas2D = document.getElementById('canvas-2d');
        const ctx2D = canvas2D.getContext('2d');
        const canvasOverlay = document.getElementById('canvas-overlay');
        const ctxOverlay = canvasOverlay.getContext('2d');
        const canvasTemplate = document.getElementById('canvas-template');
        const ctxTemplate = canvasTemplate.getContext('2d');
        const colorPicker = document.getElementById('color-picker');

        let scene, camera, renderer, controls, threeTexture, playerGroup;
        let material, overlayMaterial;
        let activeIsolatedRegion = 'all';
        let activeFaceSelection = null; // { regionKey, faceKey, label, rect:{x,y,w,h} } — seleção de face única (Seção 13)

        // Fonte única de verdade: "esse pixel está dentro do escopo de edição/visualização
        // ativo agora?" — considera a seleção de face (mais específica) OU a região isolada
        // (mais ampla). Usado por TODAS as ferramentas de pintura e pelo próprio render2DCanvas
        // ao isolar visualmente uma parte.
        function isPixelInScope(x, y) {
            if (activeFaceSelection) {
                const r = activeFaceSelection.rect;
                return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
            }
            if (activeIsolatedRegion === 'all') return true;
            return checkPixelRegion(x, y, activeIsolatedRegion);
        }

        const POPOVER_IDS = ['popover-cam-3d', 'popover-view2d', 'popover-nav2d', 'popover-remove-part', 'popover-filters', 'popover-symmetry', 'popover-copypaste', 'popover-utils', 'popover-new-layer', 'popover-export', 'popover-env3d', 'popover-animation', 'popover-collage', 'popover-shading-mode'];

        // Os popovers nasceram dentro de painéis com overflow-hidden (pros cantos
        // arredondados) — se o conteúdo deles for mais alto que o espaço restante do
        // painel, ficavam CORTADOS. Corrige "teleportando" o popover pro <body> na
        // primeira vez que abre, com position:fixed calculado a partir do botão que
        // o acionou, sempre garantindo que caiba na tela.
        function relocatePopoverToBody(pop, triggerEl) {
            if (pop.dataset.relocated !== '1') {
                pop.classList.remove('absolute');
                pop.classList.add('fixed');
                pop.style.margin = '0';
                pop.style.right = 'auto';
                document.body.appendChild(pop);
                pop.dataset.relocated = '1';
            }
            if (!triggerEl) return;

            const rect = triggerEl.getBoundingClientRect();
            pop.style.left = `${rect.left}px`;
            pop.style.top = `${rect.bottom + 6}px`;

            // Só depois de posicionar dá pra medir o tamanho real (max-h, conteúdo etc.)
            // e corrigir caso estoure a borda direita/inferior da janela.
            requestAnimationFrame(() => {
                const popRect = pop.getBoundingClientRect();
                let left = rect.left;
                if (popRect.right > window.innerWidth - 8) {
                    left = Math.max(8, window.innerWidth - popRect.width - 8);
                }
                let top = rect.bottom + 6;
                if (rect.bottom + popRect.height + 8 > window.innerHeight) {
                    top = Math.max(8, rect.top - popRect.height - 6);
                }
                pop.style.left = `${left}px`;
                pop.style.top = `${top}px`;
            });
        }

        function togglePopover(popId, triggerEl) {
            const pop = document.getElementById(popId);
            if (!pop) return;
            const isHidden = pop.classList.contains('opacity-0');
            
            POPOVER_IDS.forEach(id => {
                const p = document.getElementById(id);
                if(p) p.classList.add('opacity-0', 'scale-95', 'invisible');
            });

            if (isHidden) {
                relocatePopoverToBody(pop, triggerEl);
                pop.classList.remove('opacity-0', 'scale-95', 'invisible');
            }
        }

        // Reposicionar é barato mas manter um popover ABERTO durante um resize da janela
        // pode deixá-lo desalinhado do botão — mais simples e seguro é só fechar tudo.
        window.addEventListener('resize', () => {
            POPOVER_IDS.forEach(id => {
                const p = document.getElementById(id);
                if (p) p.classList.add('opacity-0', 'scale-95', 'invisible');
            });
        });

        document.getElementById('btn-menu-cam-3d')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-cam-3d', e.currentTarget); });
        document.getElementById('btn-menu-env3d')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-env3d', e.currentTarget); });
        document.getElementById('btn-menu-animation')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-animation', e.currentTarget); });
        document.getElementById('btn-menu-view2d')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-view2d', e.currentTarget); });
        document.getElementById('btn-menu-nav2d')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-nav2d', e.currentTarget); });
        document.getElementById('btn-menu-remove-part')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-remove-part', e.currentTarget); });
        document.getElementById('btn-menu-filters')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-filters', e.currentTarget); });
        document.getElementById('btn-menu-symmetry')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-symmetry', e.currentTarget); });
        document.getElementById('btn-menu-copypaste')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-copypaste', e.currentTarget); });
        document.getElementById('btn-menu-utils')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-utils', e.currentTarget); });
        document.getElementById('btn-menu-collage')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-collage', e.currentTarget); });
        document.getElementById('btn-menu-shading')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-shading-mode', e.currentTarget); });
        document.getElementById('btn-add-layer')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-new-layer', e.currentTarget); });
        document.getElementById('btn-export-skin')?.addEventListener('click', (e) => { e.stopPropagation(); togglePopover('popover-export', e.currentTarget); });

        document.addEventListener('click', () => {
            POPOVER_IDS.forEach(id => {
                const p = document.getElementById(id);
                if(p) p.classList.add('opacity-0', 'scale-95', 'invisible');
            });
            document.querySelectorAll('.layer-more-menu').forEach(m => m.classList.add('hidden'));
        });

        POPOVER_IDS.forEach(id => {
            document.getElementById(id)?.addEventListener('click', (e) => e.stopPropagation());
        });

        // --- SISTEMA DE MODAIS (substitui prompt()/confirm() nativos) ---
        const MODAL_IDS = ['modal-confirm', 'modal-rename', 'modal-help', 'modal-color-studio', 'modal-projects', 'modal-versions', 'modal-compare'];

        function closeAllModals() {
            MODAL_IDS.forEach(id => {
                const m = document.getElementById(id);
                if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
            });
            document.getElementById('modal-overlay')?.classList.add('hidden');
        }

        function openModal(id) {
            document.getElementById('modal-overlay')?.classList.remove('hidden');
            const m = document.getElementById(id);
            if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
        }

        document.getElementById('modal-overlay')?.addEventListener('click', closeAllModals);

        // Fecha ao clicar no fundo escuro do próprio wrapper do modal (fora do cartão).
        MODAL_IDS.forEach(id => {
            document.getElementById(id)?.addEventListener('click', (e) => {
                if (e.target.id === id) closeAllModals();
            });
        });

        // showConfirmModal(título, mensagem, callback, { confirmLabel, danger })
        function showConfirmModal(title, message, onConfirm, opts = {}) {
            const { confirmLabel = 'Confirmar', danger = true } = opts;
            document.getElementById('modal-confirm-title').textContent = title;
            document.getElementById('modal-confirm-message').textContent = message;

            const okBtn = document.getElementById('modal-confirm-ok');
            const iconWrap = document.getElementById('modal-confirm-icon');
            okBtn.textContent = confirmLabel;
            okBtn.className = danger
                ? 'px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition'
                : 'px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition';
            iconWrap.className = danger
                ? 'w-10 h-10 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center shrink-0'
                : 'w-10 h-10 rounded-full bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0';

            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            newOkBtn.addEventListener('click', () => {
                closeAllModals();
                onConfirm();
            });

            document.getElementById('modal-confirm-cancel').onclick = closeAllModals;
            openModal('modal-confirm');
        }

        // showRenameModal(nomeAtual, callback)
        function showRenameModal(currentName, onConfirm) {
            const input = document.getElementById('modal-rename-input');
            input.value = currentName;
            openModal('modal-rename');
            setTimeout(() => { input.focus(); input.select(); }, 50);

            const okBtn = document.getElementById('modal-rename-ok');
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);

            const confirmRename = () => {
                const val = input.value.trim();
                closeAllModals();
                if (val !== '') onConfirm(val);
            };

            newOkBtn.addEventListener('click', confirmRename);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') closeAllModals();
            };
            document.getElementById('modal-rename-cancel').onclick = closeAllModals;
        }

        document.getElementById('btn-help')?.addEventListener('click', () => { openModal('modal-help'); renderShortcutsList(); });
        document.getElementById('modal-help-close')?.addEventListener('click', closeAllModals);

        function update3DModelVisibility() {
            if (!playerGroup) return;
            playerGroup.traverse(mesh => {
                if (!mesh.name) return;
                const isOverlay = mesh.name.startsWith('overlay_');
                const part = mesh.name.split('_')[1];
                
                let visible = true;
                
                if (activeIsolatedRegion === 'base' && isOverlay) visible = false;
                if (activeIsolatedRegion === 'overlay' && !isOverlay) visible = false;
                
                if (activeIsolatedRegion === 'head' && part !== 'head') visible = false;
                if (activeIsolatedRegion === 'body' && part !== 'body') visible = false;
                if (activeIsolatedRegion === 'limbs' && (part === 'head' || part === 'body')) visible = false;
                
                mesh.visible = visible;
            });
        }

        function setFaceUVs(geom, faceIndex, px, py, pw, ph) {
            const uv = geom.attributes.uv;
            const u0 = px / 64.0;
            const u1 = (px + pw) / 64.0;
            const v1 = 1.0 - (py / 64.0);
            const v0 = 1.0 - ((py + ph) / 64.0);

            const offset = faceIndex * 4;
            uv.setXY(offset + 0, u0, v1);
            uv.setXY(offset + 1, u1, v1);
            uv.setXY(offset + 2, u0, v0);
            uv.setXY(offset + 3, u1, v0);
        }

        function createMCBox(w, h, d, u, v) {
            const geom = new THREE.BoxGeometry(w, h, d);
            const uw = Math.floor(w);
            const uh = Math.floor(h);
            const ud = Math.floor(d);

            setFaceUVs(geom, 0, u + ud + uw,     v + ud, ud, uh); 
            setFaceUVs(geom, 1, u,               v + ud, ud, uh); 
            setFaceUVs(geom, 2, u + ud,          v,      uw, ud); 
            setFaceUVs(geom, 3, u + ud + uw,     v,      uw, ud); 
            setFaceUVs(geom, 4, u + ud,          v + ud, uw, uh); 
            setFaceUVs(geom, 5, u + ud + uw + ud,v + ud, uw, uh); 

            return geom;
        }

        let limbPivots = {}; // { armR, armL, legR, legL } — grupos de pivô usados pelas animações

        function buildPlayerModel() {
            // Evita ficar com uma referência "pendurada" pra uma mesh que está prestes a
            // ser descartada (ex.: trocar Classic/Slim enquanto o hover 2D→3D está ativo).
            if (lastHighlightedMesh) {
                if (lastHighlightedMesh.material && lastHighlightedMesh.material.dispose) {
                    lastHighlightedMesh.material.dispose();
                }
                lastHighlightedMesh = null;
            }

            if (playerGroup) {
                scene.remove(playerGroup);
                playerGroup.traverse(c => {
                    if (c.geometry) c.geometry.dispose();
                });
            }

            playerGroup = new THREE.Group();
            
            const armW = State.modelType === 'slim' ? 3 : 4;
            const armR_X = State.modelType === 'slim' ? -5.5 : -6;
            const armL_X = State.modelType === 'slim' ? 5.5 : 6;
            const armW_overlay = State.modelType === 'slim' ? 3.5 : 4.5;

            const headMesh = new THREE.Mesh(createMCBox(8, 8, 8, 0, 0), material);
            headMesh.position.y = 12;
            headMesh.name = 'base_head';
            playerGroup.add(headMesh);

            const bodyMesh = new THREE.Mesh(createMCBox(8, 12, 4, 16, 16), material);
            bodyMesh.position.y = 2;
            bodyMesh.name = 'base_body';
            playerGroup.add(bodyMesh);

            const hatMesh = new THREE.Mesh(createMCBox(8.5, 8.5, 8.5, 32, 0), overlayMaterial);
            hatMesh.position.y = 12;
            hatMesh.name = 'overlay_head';
            playerGroup.add(hatMesh);

            const jacketMesh = new THREE.Mesh(createMCBox(8.5, 12.5, 4.5, 16, 32), overlayMaterial);
            jacketMesh.position.y = 2;
            jacketMesh.name = 'overlay_body';
            playerGroup.add(jacketMesh);

            // Braços e pernas ficam num grupo de pivô posicionado na articulação
            // (ombro / quadril) para que as animações possam girá-los naturalmente.
            const armRPivot = new THREE.Group();
            armRPivot.position.set(armR_X, 8, 0);
            const armRMesh = new THREE.Mesh(createMCBox(armW, 12, 4, 40, 16), material);
            armRMesh.position.set(0, -6, 0);
            armRMesh.name = 'base_armR';
            armRPivot.add(armRMesh);
            const sleeveRMesh = new THREE.Mesh(createMCBox(armW_overlay, 12.5, 4.5, 40, 32), overlayMaterial);
            sleeveRMesh.position.set(0, -6, 0);
            sleeveRMesh.name = 'overlay_armR';
            armRPivot.add(sleeveRMesh);
            playerGroup.add(armRPivot);

            const armLPivot = new THREE.Group();
            armLPivot.position.set(armL_X, 8, 0);
            const armLMesh = new THREE.Mesh(createMCBox(armW, 12, 4, 32, 48), material);
            armLMesh.position.set(0, -6, 0);
            armLMesh.name = 'base_armL';
            armLPivot.add(armLMesh);
            const sleeveLMesh = new THREE.Mesh(createMCBox(armW_overlay, 12.5, 4.5, 48, 48), overlayMaterial);
            sleeveLMesh.position.set(0, -6, 0);
            sleeveLMesh.name = 'overlay_armL';
            armLPivot.add(sleeveLMesh);
            playerGroup.add(armLPivot);

            const legRPivot = new THREE.Group();
            legRPivot.position.set(-2, -4, 0);
            const legRMesh = new THREE.Mesh(createMCBox(4, 12, 4, 0, 16), material);
            legRMesh.position.set(0, -6, 0);
            legRMesh.name = 'base_legR';
            legRPivot.add(legRMesh);
            const pantsRMesh = new THREE.Mesh(createMCBox(4.5, 12.5, 4.5, 0, 32), overlayMaterial);
            pantsRMesh.position.set(0, -6, 0);
            pantsRMesh.name = 'overlay_legR';
            legRPivot.add(pantsRMesh);
            playerGroup.add(legRPivot);

            const legLPivot = new THREE.Group();
            legLPivot.position.set(2, -4, 0);
            const legLMesh = new THREE.Mesh(createMCBox(4, 12, 4, 16, 48), material);
            legLMesh.position.set(0, -6, 0);
            legLMesh.name = 'base_legL';
            legLPivot.add(legLMesh);
            const pantsLMesh = new THREE.Mesh(createMCBox(4.5, 12.5, 4.5, 0, 48), overlayMaterial);
            pantsLMesh.position.set(0, -6, 0);
            pantsLMesh.name = 'overlay_legL';
            legLPivot.add(pantsLMesh);
            playerGroup.add(legLPivot);

            limbPivots = { armR: armRPivot, armL: armLPivot, legR: legRPivot, legL: legLPivot };

            scene.add(playerGroup);
            update3DModelVisibility();
        }

        function createLayerObject(name, initialData = null) {
            const lCanvas = document.createElement('canvas');
            lCanvas.width = 64;
            lCanvas.height = 64;
            const lCtx = lCanvas.getContext('2d', { willReadFrequently: true });
            lCtx.imageSmoothingEnabled = false;

            if (initialData) {
                lCtx.putImageData(initialData, 0, 0);
            }

            return {
                id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: name,
                visible: true,
                locked: false,
                opacity: 1.0,
                canvas: lCanvas,
                ctx: lCtx
            };
        }

        // --- ATUALIZAÇÃO IMPORTANTE ---
        // Cria um modelo básico visível inicial em vez de deixar transparente,
        // para garantir que o jogador veja o modelo em 3D.
        function createDefaultSkinBase(ctx) {
            // Cor da pele
            ctx.fillStyle = '#ffcc99';
            ctx.fillRect(0, 0, 32, 16); // Cabeça inteira
            ctx.fillRect(40, 16, 16, 16); // Braço direito
            ctx.fillRect(32, 48, 16, 16); // Braço esquerdo
            
            // Camisa (Azul turquesa)
            ctx.fillStyle = '#00aaaa';
            ctx.fillRect(16, 16, 24, 16); // Tronco
            
            // Calças (Azul escuro)
            ctx.fillStyle = '#222288';
            ctx.fillRect(0, 16, 16, 16); // Perna direita
            ctx.fillRect(16, 48, 16, 16); // Perna esquerda
            
            // Detalhes rosto
            ctx.fillStyle = '#333333';
            ctx.fillRect(10, 10, 2, 2); // Olho
            ctx.fillRect(14, 10, 2, 2); // Olho
        }

        // Fonte única de verdade para as regiões do template UV (64x64).
        // Usada para: desenhar o guia do template, montar a legenda de cores
        // e alimentar o menu "Remover Parte" da camada ativa.
        const REGIONS_INFO = [
            { key: 'head',              label: 'Cabeça',                  color: 'rgba(255, 215, 0, 0.4)',   swatch: '#FFD700', x: 0,  y: 0,  w: 32, h: 16 },
            { key: 'head_overlay',      label: 'Cabeça (Chapéu)',         color: 'rgba(255, 140, 0, 0.4)',   swatch: '#FF8C00', x: 32, y: 0,  w: 32, h: 16 },
            { key: 'right_leg',         label: 'Perna Direita',           color: 'rgba(255, 69, 0, 0.4)',    swatch: '#FF4500', x: 0,  y: 16, w: 16, h: 16 },
            { key: 'body',              label: 'Tronco',                  color: 'rgba(0, 255, 255, 0.4)',   swatch: '#00FFFF', x: 16, y: 16, w: 24, h: 16 },
            { key: 'right_arm',         label: 'Braço Direito',           color: 'rgba(138, 43, 226, 0.4)',  swatch: '#8A2BE2', x: 40, y: 16, w: 16, h: 16 },
            { key: 'right_leg_overlay', label: 'Perna Direita (Overlay)', color: 'rgba(255, 99, 71, 0.4)',   swatch: '#FF6347', x: 0,  y: 32, w: 16, h: 16 },
            { key: 'body_overlay',      label: 'Tronco (Casaco/Overlay)', color: 'rgba(224, 255, 255, 0.4)', swatch: '#E0FFFF', x: 16, y: 32, w: 24, h: 16 },
            { key: 'right_arm_overlay', label: 'Braço Direito (Overlay)', color: 'rgba(216, 191, 216, 0.4)', swatch: '#D8BFD8', x: 40, y: 32, w: 16, h: 16 },
            { key: 'left_leg',          label: 'Perna Esquerda',          color: 'rgba(255, 20, 147, 0.4)',  swatch: '#FF1493', x: 16, y: 48, w: 16, h: 16 },
            { key: 'left_arm',          label: 'Braço Esquerdo',          color: 'rgba(50, 205, 50, 0.4)',   swatch: '#32CD32', x: 32, y: 48, w: 16, h: 16 },
            { key: 'left_leg_overlay',  label: 'Perna Esquerda (Overlay)',color: 'rgba(255, 182, 193, 0.4)', swatch: '#FFB6C1', x: 0,  y: 48, w: 16, h: 16 },
            { key: 'left_arm_overlay',  label: 'Braço Esquerdo (Overlay)',color: 'rgba(152, 251, 152, 0.4)', swatch: '#98FB98', x: 48, y: 48, w: 16, h: 16 }
        ];

        // --- SIMETRIA UV-CORRETA (espelho braço/perna/cabeça/tronco) ---
        // Cada "bloco" da textura (cabeça, tronco, braço, perna) é desenrolado em 6 faces
        // (topo, base, direita, frente, esquerda, costas). Espelhar corretamente significa:
        // frente/costas/topo/base viram um espelho-dentro-da-própria-face, e as faces
        // laterais "direita" e "esquerda" TROCAM de lugar entre si (senão o desenho fica
        // com a lateral errada ao virar o personagem).
        const FACE_SWAP = { top: 'top', bottom: 'bottom', front: 'front', back: 'back', right: 'left', left: 'right' };

        const HEAD_FACE_TEMPLATE = {
            top:    { x: 8,  y: 0, w: 8, h: 8 },
            bottom: { x: 16, y: 0, w: 8, h: 8 },
            right:  { x: 0,  y: 8, w: 8, h: 8 },
            front:  { x: 8,  y: 8, w: 8, h: 8 },
            left:   { x: 16, y: 8, w: 8, h: 8 },
            back:   { x: 24, y: 8, w: 8, h: 8 }
        };
        const BODY_FACE_TEMPLATE = {
            top:    { x: 4,  y: 0, w: 8, h: 4 },
            bottom: { x: 12, y: 0, w: 8, h: 4 },
            right:  { x: 0,  y: 4, w: 4, h: 12 },
            front:  { x: 4,  y: 4, w: 8, h: 12 },
            left:   { x: 12, y: 4, w: 4, h: 12 },
            back:   { x: 16, y: 4, w: 8, h: 12 }
        };
        const LIMB_FACE_TEMPLATE = { // braços (classic) e pernas
            top:    { x: 4, y: 0, w: 4, h: 4 },
            bottom: { x: 8, y: 0, w: 4, h: 4 },
            right:  { x: 0, y: 4, w: 4, h: 12 },
            front:  { x: 4, y: 4, w: 4, h: 12 },
            left:   { x: 8, y: 4, w: 4, h: 12 },
            back:   { x: 12,y: 4, w: 4, h: 12 }
        };

        // Pares de blocos espelhados: { origemA, origemB, template }. Quando A === B, o
        // espelhamento acontece dentro do próprio bloco (ex.: desenho simétrico no rosto).
        const MIRROR_GROUPS = [
            { a: { x: 0,  y: 0 },  b: { x: 0,  y: 0 },  template: HEAD_FACE_TEMPLATE }, // cabeça (self)
            { a: { x: 32, y: 0 },  b: { x: 32, y: 0 },  template: HEAD_FACE_TEMPLATE }, // chapéu overlay (self)
            { a: { x: 16, y: 16 }, b: { x: 16, y: 16 }, template: BODY_FACE_TEMPLATE }, // tronco (self)
            { a: { x: 16, y: 32 }, b: { x: 16, y: 32 }, template: BODY_FACE_TEMPLATE }, // casaco overlay (self)
            { a: { x: 0,  y: 16 }, b: { x: 16, y: 48 }, template: LIMB_FACE_TEMPLATE }, // perna dir <-> esq
            { a: { x: 40, y: 16 }, b: { x: 32, y: 48 }, template: LIMB_FACE_TEMPLATE }, // braço dir <-> esq
            { a: { x: 0,  y: 32 }, b: { x: 0,  y: 48 }, template: LIMB_FACE_TEMPLATE }, // perna overlay dir <-> esq
            { a: { x: 40, y: 32 }, b: { x: 48, y: 48 }, template: LIMB_FACE_TEMPLATE }  // braço overlay dir <-> esq
        ];

        // Constrói (uma única vez) o mapa "x,y" → {x,y} espelhado, cobrindo os dois sentidos.
        function buildMirrorMap() {
            const map = new Map();
            function addDirection(template, originSrc, originDst) {
                Object.entries(template).forEach(([faceKey, rect]) => {
                    const targetKey = FACE_SWAP[faceKey];
                    const targetRect = template[targetKey];
                    for (let ly = 0; ly < rect.h; ly++) {
                        for (let lx = 0; lx < rect.w; lx++) {
                            const srcX = originSrc.x + rect.x + lx;
                            const srcY = originSrc.y + rect.y + ly;
                            const mirroredLx = rect.w - 1 - lx;
                            const dstX = originDst.x + targetRect.x + mirroredLx;
                            const dstY = originDst.y + targetRect.y + ly;
                            map.set(`${srcX},${srcY}`, { x: dstX, y: dstY });
                        }
                    }
                });
            }
            MIRROR_GROUPS.forEach(({ a, b, template }) => {
                addDirection(template, a, b);
                addDirection(template, b, a);
            });
            return map;
        }
        const UV_MIRROR_MAP = buildMirrorMap();

        // --- MAPA DE FACES CLICÁVEIS (Seção 13 — Seleção de Face) ---
        // Reaproveita os mesmos templates de face da simetria para saber exatamente qual
        // sub-retângulo (topo/base/frente/costas/esquerda/direita) de qual parte um pixel
        // pertence. Também serve à dica (tooltip) do Editor UV (Seção 12).
        const FACE_LABELS = { top: 'Topo', bottom: 'Base', front: 'Frente', back: 'Costas', left: 'Lateral Esq.', right: 'Lateral Dir.' };

        const FACE_PART_DEFS = [
            { regionKey: 'head',              label: 'Cabeça',              origin: { x: 0,  y: 0 },  template: HEAD_FACE_TEMPLATE },
            { regionKey: 'head_overlay',       label: 'Chapéu',              origin: { x: 32, y: 0 },  template: HEAD_FACE_TEMPLATE },
            { regionKey: 'body',               label: 'Tronco',              origin: { x: 16, y: 16 }, template: BODY_FACE_TEMPLATE },
            { regionKey: 'body_overlay',       label: 'Casaco',              origin: { x: 16, y: 32 }, template: BODY_FACE_TEMPLATE },
            { regionKey: 'right_leg',          label: 'Perna Direita',       origin: { x: 0,  y: 16 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'left_leg',           label: 'Perna Esquerda',      origin: { x: 16, y: 48 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'right_arm',          label: 'Braço Direito',       origin: { x: 40, y: 16 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'left_arm',           label: 'Braço Esquerdo',      origin: { x: 32, y: 48 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'right_leg_overlay',  label: 'Perna Dir. (Overlay)',origin: { x: 0,  y: 32 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'left_leg_overlay',   label: 'Perna Esq. (Overlay)',origin: { x: 0,  y: 48 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'right_arm_overlay',  label: 'Manga Direita',       origin: { x: 40, y: 32 }, template: LIMB_FACE_TEMPLATE },
            { regionKey: 'left_arm_overlay',   label: 'Manga Esquerda',      origin: { x: 48, y: 48 }, template: LIMB_FACE_TEMPLATE }
        ];

        // Mapeia cada regionKey para o nome da mesh 3D correspondente (ver buildPlayerModel).
        const REGION_TO_MESH_NAME = {
            head: 'base_head', head_overlay: 'overlay_head',
            body: 'base_body', body_overlay: 'overlay_body',
            right_leg: 'base_legR', left_leg: 'base_legL',
            right_arm: 'base_armR', left_arm: 'base_armL',
            right_leg_overlay: 'overlay_legR', left_leg_overlay: 'overlay_legL',
            right_arm_overlay: 'overlay_armR', left_arm_overlay: 'overlay_armL'
        };

        function buildFaceRegionsMap() {
            const map = [];
            FACE_PART_DEFS.forEach(def => {
                Object.entries(def.template).forEach(([faceKey, rect]) => {
                    map.push({
                        regionKey: def.regionKey,
                        partLabel: def.label,
                        faceKey,
                        label: `${FACE_LABELS[faceKey]} — ${def.label}`,
                        rect: { x: def.origin.x + rect.x, y: def.origin.y + rect.y, w: rect.w, h: rect.h }
                    });
                });
            });
            return map;
        }
        const FACE_REGIONS_MAP = buildFaceRegionsMap();

        // Dado um pixel de textura, retorna a face exata (parte + topo/frente/etc.) a que pertence.
        function findFaceAtPixel(x, y) {
            return FACE_REGIONS_MAP.find(f => x >= f.rect.x && x < f.rect.x + f.rect.w && y >= f.rect.y && y < f.rect.y + f.rect.h) || null;
        }

        // Realça temporariamente uma mesh específica do personagem 3D sem afetar as demais
        // (que compartilham o mesmo material base) — troca por um clone só durante o hover.
        let lastHighlightedMesh = null;
        function highlightMeshByRegion(regionKey) {
            clearMeshHighlight();
            const meshName = REGION_TO_MESH_NAME[regionKey];
            if (!meshName || !playerGroup) return;
            playerGroup.traverse(mesh => {
                if (mesh.name === meshName && mesh.isMesh) {
                    mesh._originalMaterial = mesh.material;
                    const clone = mesh.material.clone();
                    clone.emissive = new THREE.Color(0x38bdf8);
                    clone.emissiveIntensity = 0.55;
                    mesh.material = clone;
                    lastHighlightedMesh = mesh;
                }
            });
        }
        function clearMeshHighlight() {
            if (lastHighlightedMesh && lastHighlightedMesh._originalMaterial) {
                lastHighlightedMesh.material.dispose();
                lastHighlightedMesh.material = lastHighlightedMesh._originalMaterial;
                lastHighlightedMesh._originalMaterial = null;
            }
            lastHighlightedMesh = null;
        }

        // Retorna as coordenadas extras a pintar/apagar junto de (x,y), de acordo com o
        // modo de simetria atual. Sempre um array (pode ser vazio).
        function getMirrorTargets(x, y) {
            const mode = State.symmetryMode;
            if (mode === 'off') return [];
            const targets = [];
            if (mode === 'h' || mode === 'both') targets.push({ x: 63 - x, y: y });
            if (mode === 'v' || mode === 'both') targets.push({ x: x, y: 63 - y });
            if (mode === 'both') targets.push({ x: 63 - x, y: 63 - y });
            if (mode === 'uv') {
                const hit = UV_MIRROR_MAP.get(`${x},${y}`);
                if (hit) targets.push(hit);
            }
            return targets;
        }

        // Executa `painter(ctx, px, py)` no pixel (x,y) e em todos os seus espelhos válidos,
        // respeitando limites do canvas e a região isolada ativa. Usado por todas as
        // ferramentas de pintura para que a simetria funcione de forma consistente.
        function paintPixelWithSymmetry(ctx, x, y, painter) {
            const applyAt = (px, py) => {
                if (px < 0 || px >= 64 || py < 0 || py >= 64) return;
                if (!isPixelInScope(px, py)) return;
                painter(ctx, px, py);
            };
            applyAt(x, y);
            getMirrorTargets(x, y).forEach(t => applyAt(t.x, t.y));
        }

        function drawTemplateGuide() {
            ctxTemplate.clearRect(0, 0, 64, 64);

            REGIONS_INFO.forEach(region => {
                ctxTemplate.fillStyle = region.color;
                ctxTemplate.fillRect(region.x, region.y, region.w, region.h);
                ctxTemplate.strokeStyle = 'rgba(0,0,0,0.5)';
                ctxTemplate.lineWidth = 1;
                ctxTemplate.strokeRect(region.x, region.y, region.w, region.h);
            });
        }

        // Monta a legenda de cores exibida no canto do painel 2D quando o
        // Guia UV (Template) está ativado.
        function renderTemplateLegend() {
            const listEl = document.getElementById('template-legend-list');
            if (!listEl) return;
            listEl.innerHTML = REGIONS_INFO.map(region => `
                <div class="flex items-center gap-1.5">
                    <span class="legend-swatch" style="background-color: ${region.swatch};"></span>
                    <span class="text-[10px] text-slate-300 leading-tight">${region.label}</span>
                </div>
            `).join('');
        }

        // Apaga (torna transparente) uma região específica na camada ativa.
        function clearRegionOnActiveLayer(regionKey) {
            const region = REGIONS_INFO.find(r => r.key === regionKey);
            if (!region) return;

            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;

            if (activeLayer.locked) {
                showToast('Camada ativa bloqueada! Destrave para editar.', 'warning');
                return;
            }

            activeLayer.ctx.clearRect(region.x, region.y, region.w, region.h);
            render2DCanvas();
            renderLayerUI();
            saveHistoryState();
            showToast(`"${region.label}" removida da camada "${activeLayer.name}"`, 'success');
        }

        // Preenche o menu "Remover Parte" com um botão por região.
        function initRemovePartUI() {
            const listEl = document.getElementById('remove-part-list');
            if (!listEl) return;
            listEl.innerHTML = '';

            REGIONS_INFO.forEach(region => {
                const btn = document.createElement('button');
                btn.className = 'remove-part-btn flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-300 text-left transition w-full';
                btn.innerHTML = `<span class="legend-swatch" style="background-color: ${region.swatch};"></span> Remover ${region.label}`;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clearRegionOnActiveLayer(region.key);
                    togglePopover('popover-remove-part');
                });
                listEl.appendChild(btn);
            });
        }

        // --- FILTROS (aplicados na camada ativa, respeitando a região isolada) ---

        // Executa `callback(d, idx, x, y)` sobre cada pixel elegível da camada ativa
        // (opaco, dentro da região isolada) e grava o resultado de volta no canvas.
        function withActiveLayerPixels(callback, opts = {}) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return false;
            if (activeLayer.locked) {
                showToast('Camada ativa bloqueada! Destrave para editar.', 'warning');
                return false;
            }
            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const d = imgData.data;
            let touched = false;

            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const idx = (y * 64 + x) * 4;
                    if (d[idx + 3] === 0 && !opts.includeTransparent) continue;
                    if (!isPixelInScope(x, y)) continue;
                    callback(d, idx, x, y);
                    touched = true;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
            if (touched) saveHistoryState();
            return touched;
        }

        function filterSaturate(delta) {
            const ok = withActiveLayerPixels((d, idx) => {
                const hsl = rgbToHsl(d[idx], d[idx + 1], d[idx + 2]);
                const rgb = hslToRgb(hsl.h, Math.max(0, Math.min(100, hsl.s + delta)), hsl.l);
                d[idx] = rgb.r; d[idx + 1] = rgb.g; d[idx + 2] = rgb.b;
            });
            if (ok) showToast(delta > 0 ? 'Saturação aumentada' : 'Saturação reduzida', 'success');
        }
        function filterInvert() {
            const ok = withActiveLayerPixels((d, idx) => {
                d[idx] = 255 - d[idx]; d[idx + 1] = 255 - d[idx + 1]; d[idx + 2] = 255 - d[idx + 2];
            });
            if (ok) showToast('Cores invertidas', 'success');
        }
        function filterGrayscale() {
            const ok = withActiveLayerPixels((d, idx) => {
                const l = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
                d[idx] = d[idx + 1] = d[idx + 2] = l;
            });
            if (ok) showToast('Convertido para escala de cinza', 'success');
        }
        function filterNoise(amount = 20) {
            const ok = withActiveLayerPixels((d, idx) => {
                const n = (Math.random() * 2 - 1) * amount;
                d[idx] = Math.max(0, Math.min(255, d[idx] + n));
                d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + n));
                d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + n));
            });
            if (ok) showToast('Ruído aplicado', 'success');
        }
        // Dithering ordenado (matriz de Bayer 4x4) — dá um visual "retrô" posterizado.
        function filterDither() {
            const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
            const levels = 4;
            const ok = withActiveLayerPixels((d, idx, x, y) => {
                const threshold = (bayer[y % 4][x % 4] / 16 - 0.5) * (255 / levels);
                const step = 255 / (levels - 1);
                for (let c = 0; c < 3; c++) {
                    const v = d[idx + c] + threshold;
                    d[idx + c] = Math.max(0, Math.min(255, Math.round(v / step) * step));
                }
            });
            if (ok) showToast('Dithering aplicado', 'success');
        }
        function filterRandomize(amount = 25) {
            const ok = withActiveLayerPixels((d, idx) => {
                const hsl = rgbToHsl(d[idx], d[idx + 1], d[idx + 2]);
                const rgb = hslToRgb(hsl.h + (Math.random() * 2 - 1) * amount, hsl.s, hsl.l);
                d[idx] = rgb.r; d[idx + 1] = rgb.g; d[idx + 2] = rgb.b;
            });
            if (ok) showToast('Cores aleatorizadas', 'success');
        }
        function filterHueShift(degrees) {
            const ok = withActiveLayerPixels((d, idx) => {
                const hsl = rgbToHsl(d[idx], d[idx + 1], d[idx + 2]);
                const rgb = hslToRgb(hsl.h + degrees, hsl.s, hsl.l);
                d[idx] = rgb.r; d[idx + 1] = rgb.g; d[idx + 2] = rgb.b;
            });
            if (ok) showToast(`Matiz girado ${degrees > 0 ? '+' : ''}${degrees}°`, 'success');
        }
        // Sombreamento automático: mais claro no topo de cada região UV, mais escuro na base.
        function filterAutoShade() {
            const ok = withActiveLayerPixels((d, idx, x, y) => {
                const region = REGIONS_INFO.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
                if (!region) return;
                const t = (y - region.y) / Math.max(1, region.h - 1);
                const factor = 0.22 - t * 0.44;
                d[idx]     = Math.max(0, Math.min(255, d[idx]     + d[idx]     * factor));
                d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + d[idx + 1] * factor));
                d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + d[idx + 2] * factor));
            });
            if (ok) showToast('Sombreamento automático aplicado', 'success');
        }
        // Contorna pixels vazios adjacentes ao desenho (sem "engordar" o próprio desenho).
        function filterOutline() {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const src = new Uint8ClampedArray(imgData.data);
            const rgb = hexToRgb(State.currentColor);
            const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            let any = false;

            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const idx = (y * 64 + x) * 4;
                    if (src[idx + 3] !== 0) continue;
                    if (!isPixelInScope(x, y)) continue;
                    const hasOpaqueNeighbor = neighbors.some(([dx, dy]) => {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= 64 || ny < 0 || ny >= 64) return false;
                        return src[(ny * 64 + nx) * 4 + 3] !== 0;
                    });
                    if (hasOpaqueNeighbor) {
                        imgData.data[idx] = rgb.r; imgData.data[idx + 1] = rgb.g; imgData.data[idx + 2] = rgb.b; imgData.data[idx + 3] = 255;
                        any = true;
                    }
                }
            }
            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
            if (any) saveHistoryState();
            showToast(any ? 'Contorno adicionado' : 'Nenhum pixel vazio adjacente para contornar', any ? 'success' : 'info');
        }

        // --- MODO DE SOMBREAMENTO DEDICADO (Seção 22) ---
        // t=0 do lado de onde "vem a luz", t=1 do lado oposto — computado por região UV,
        // reaproveitando os mesmos retângulos do template (REGIONS_INFO).
        function computeLightFactor(region, x, y, dir) {
            let t;
            if (dir === 'top') t = (y - region.y) / Math.max(1, region.h - 1);
            else if (dir === 'bottom') t = 1 - (y - region.y) / Math.max(1, region.h - 1);
            else if (dir === 'left') t = (x - region.x) / Math.max(1, region.w - 1);
            else t = 1 - (x - region.x) / Math.max(1, region.w - 1);
            return Math.max(0, Math.min(1, t));
        }

        function shadeAmbient() {
            const intensity = State.shadingIntensity / 100;
            const ok = withActiveLayerPixels((d, idx, x, y) => {
                const region = REGIONS_INFO.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
                if (!region) return;
                const factor = -intensity * computeLightFactor(region, x, y, State.shadingLightDir);
                d[idx]     = Math.max(0, Math.min(255, d[idx]     + d[idx]     * factor));
                d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + d[idx + 1] * factor));
                d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + d[idx + 2] * factor));
            });
            if (ok) showToast('Sombra ambiente aplicada', 'success');
        }

        function shadeHighlight() {
            const intensity = State.shadingIntensity / 100;
            const ok = withActiveLayerPixels((d, idx, x, y) => {
                const region = REGIONS_INFO.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
                if (!region) return;
                const factor = intensity * (1 - computeLightFactor(region, x, y, State.shadingLightDir));
                d[idx]     = Math.max(0, Math.min(255, d[idx]     + d[idx]     * factor));
                d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + d[idx + 1] * factor));
                d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + d[idx + 2] * factor));
            });
            if (ok) showToast('Realce (highlight) aplicado', 'success');
        }

        // Clareia/escurece só os pixels de BORDA (opacos adjacentes a um vizinho vazio).
        function shadeEdges(lighten) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const src = new Uint8ClampedArray(imgData.data);
            const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const factor = (State.shadingIntensity / 100) * (lighten ? 1 : -1);
            let any = false;

            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const idx = (y * 64 + x) * 4;
                    if (src[idx + 3] === 0) continue;
                    if (!isPixelInScope(x, y)) continue;
                    const isEdge = neighbors.some(([dx, dy]) => {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= 64 || ny < 0 || ny >= 64) return true;
                        return src[(ny * 64 + nx) * 4 + 3] === 0;
                    });
                    if (!isEdge) continue;
                    imgData.data[idx]     = Math.max(0, Math.min(255, src[idx]     + src[idx]     * factor));
                    imgData.data[idx + 1] = Math.max(0, Math.min(255, src[idx + 1] + src[idx + 1] * factor));
                    imgData.data[idx + 2] = Math.max(0, Math.min(255, src[idx + 2] + src[idx + 2] * factor));
                    any = true;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
            if (any) saveHistoryState();
            showToast(any ? `Bordas ${lighten ? 'clareadas' : 'escurecidas'}` : 'Nenhum pixel de borda encontrado', any ? 'success' : 'info');
        }

        // Escurece só os pixels INTERNOS (opacos cercados por outros opacos) — efeito de
        // sombra "encaixada" pra dentro do desenho, mantendo a borda mais clara.
        function shadeInner() {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const src = new Uint8ClampedArray(imgData.data);
            const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const intensity = State.shadingIntensity / 100;
            let any = false;

            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const idx = (y * 64 + x) * 4;
                    if (src[idx + 3] === 0) continue;
                    if (!isPixelInScope(x, y)) continue;
                    const isEdge = neighbors.some(([dx, dy]) => {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= 64 || ny < 0 || ny >= 64) return true;
                        return src[(ny * 64 + nx) * 4 + 3] === 0;
                    });
                    if (isEdge) continue;
                    imgData.data[idx]     = Math.max(0, Math.min(255, src[idx]     - src[idx]     * intensity));
                    imgData.data[idx + 1] = Math.max(0, Math.min(255, src[idx + 1] - src[idx + 1] * intensity));
                    imgData.data[idx + 2] = Math.max(0, Math.min(255, src[idx + 2] - src[idx + 2] * intensity));
                    any = true;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
            if (any) saveHistoryState();
            showToast(any ? 'Sombra interna aplicada' : 'Nenhum pixel interno encontrado', any ? 'success' : 'info');
        }

        document.querySelectorAll('.shading-dir-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.shading-dir-btn').forEach(b => {
                    b.classList.remove('active', 'bg-yellow-600/80', 'border-yellow-500', 'text-white');
                    b.classList.add('bg-slate-800', 'border-slate-700', 'text-slate-200');
                });
                btn.classList.add('active', 'bg-yellow-600/80', 'border-yellow-500', 'text-white');
                btn.classList.remove('bg-slate-800', 'border-slate-700', 'text-slate-200');
                State.shadingLightDir = btn.dataset.dir;
            });
        });
        document.getElementById('slider-shading-intensity')?.addEventListener('input', (e) => {
            State.shadingIntensity = parseInt(e.target.value);
            const label = document.getElementById('label-shading-intensity');
            if (label) label.textContent = `${State.shadingIntensity}%`;
        });
        document.getElementById('btn-shade-lighten-edges')?.addEventListener('click', () => { shadeEdges(true); togglePopover('popover-shading-mode'); });
        document.getElementById('btn-shade-darken-edges')?.addEventListener('click', () => { shadeEdges(false); togglePopover('popover-shading-mode'); });
        document.getElementById('btn-shade-ambient')?.addEventListener('click', () => { shadeAmbient(); togglePopover('popover-shading-mode'); });
        document.getElementById('btn-shade-inner')?.addEventListener('click', () => { shadeInner(); togglePopover('popover-shading-mode'); });
        document.getElementById('btn-shade-highlight')?.addEventListener('click', () => { shadeHighlight(); togglePopover('popover-shading-mode'); });

        // "Trocar Cor": clique em "Selecionar Origem" e depois clique num pixel do canvas 2D
        // para trocar todos os pixels daquela cor (na camada ativa) pela cor atual.
        let isPickingReplaceSource = false;
        function startColorReplace() {
            isPickingReplaceSource = true;
            showToast('Clique em um pixel na tela 2D para escolher a cor a substituir', 'info');
        }
        function performColorReplace(sourceHex) {
            const target = hexToRgb(State.currentColor);
            const src = hexToRgb(sourceHex);
            const ok = withActiveLayerPixels((d, idx) => {
                if (Math.abs(d[idx] - src.r) <= 6 && Math.abs(d[idx + 1] - src.g) <= 6 && Math.abs(d[idx + 2] - src.b) <= 6) {
                    d[idx] = target.r; d[idx + 1] = target.g; d[idx + 2] = target.b;
                }
            });
            showToast(ok ? 'Cor substituída' : 'Nenhum pixel com essa cor foi encontrado', ok ? 'success' : 'info');
        }

        const FILTERS_LIST = [
            { label: 'Saturar', icon: 'fa-solid fa-droplet', action: () => filterSaturate(15) },
            { label: 'Dessaturar', icon: 'fa-regular fa-droplet', action: () => filterSaturate(-15) },
            { label: 'Girar Matiz -15°', icon: 'fa-solid fa-rotate-left', action: () => filterHueShift(-15) },
            { label: 'Girar Matiz +15°', icon: 'fa-solid fa-rotate-right', action: () => filterHueShift(15) },
            { label: 'Inverter Cores', icon: 'fa-solid fa-circle-half-stroke', action: filterInvert },
            { label: 'Escala de Cinza', icon: 'fa-solid fa-circle', action: filterGrayscale },
            { label: 'Ruído', icon: 'fa-solid fa-braille', action: () => filterNoise(20) },
            { label: 'Dithering', icon: 'fa-solid fa-grip', action: filterDither },
            { label: 'Aleatorizar Cores', icon: 'fa-solid fa-shuffle', action: () => filterRandomize(25) },
            { label: 'Sombreamento Automático', icon: 'fa-solid fa-circle-half-stroke', action: filterAutoShade },
            { label: 'Contornar', icon: 'fa-regular fa-square', action: filterOutline },
            { label: 'Trocar Cor (clique na tela)', icon: 'fa-solid fa-arrow-right-arrow-left', action: startColorReplace }
        ];

        function initFiltersUI() {
            const listEl = document.getElementById('filters-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            FILTERS_LIST.forEach(filter => {
                const btn = document.createElement('button');
                btn.className = 'flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-300 text-left transition w-full';
                btn.innerHTML = `<i class="${filter.icon} text-fuchsia-400 w-4 text-center"></i> ${filter.label}`;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    filter.action();
                    togglePopover('popover-filters');
                });
                listEl.appendChild(btn);
            });
        }

        // --- COPIAR / COLAR PARTES (espelho UV-correto + clipboard com transformações) ---

        // Espelha uma região inteira para seu par correspondente (ou dentro de si mesma, nos
        // casos de auto-simetria como cabeça/tronco), usando o UV_MIRROR_MAP pixel a pixel.
        function mirrorPartUV(regionKey) {
            const region = REGIONS_INFO.find(r => r.key === regionKey);
            if (!region) return;
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const ctx = activeLayer.ctx;
            const full = ctx.getImageData(0, 0, 64, 64);
            const src = new Uint8ClampedArray(full.data); // snapshot imutável para leitura
            let count = 0;

            for (let y = region.y; y < region.y + region.h; y++) {
                for (let x = region.x; x < region.x + region.w; x++) {
                    const target = UV_MIRROR_MAP.get(`${x},${y}`);
                    if (!target) continue;
                    const srcIdx = (y * 64 + x) * 4;
                    const dstIdx = (target.y * 64 + target.x) * 4;
                    full.data[dstIdx]     = src[srcIdx];
                    full.data[dstIdx + 1] = src[srcIdx + 1];
                    full.data[dstIdx + 2] = src[srcIdx + 2];
                    full.data[dstIdx + 3] = src[srcIdx + 3];
                    count++;
                }
            }
            ctx.putImageData(full, 0, 0);
            render2DCanvas();
            if (count > 0) saveHistoryState();
            showToast(`"${region.label}" espelhado (UV)`, 'success');
        }

        const MIRROR_PART_BUTTONS = [
            { from: 'right_arm', label: 'Braço Direito → Esquerdo' },
            { from: 'left_arm', label: 'Braço Esquerdo → Direito' },
            { from: 'right_leg', label: 'Perna Direita → Esquerda' },
            { from: 'left_leg', label: 'Perna Esquerda → Direita' },
            { from: 'right_arm_overlay', label: 'Manga Direita → Esquerda' },
            { from: 'left_arm_overlay', label: 'Manga Esquerda → Direita' },
            { from: 'right_leg_overlay', label: 'Perna Dir. Overlay → Esq.' },
            { from: 'left_leg_overlay', label: 'Perna Esq. Overlay → Dir.' },
            { from: 'head', label: 'Cabeça (auto-simetria)' },
            { from: 'head_overlay', label: 'Chapéu (auto-simetria)' },
            { from: 'body', label: 'Tronco (auto-simetria)' },
            { from: 'body_overlay', label: 'Casaco (auto-simetria)' }
        ];

        // --- Clipboard genérico (copiar região → transformar → colar em qualquer região) ---
        let PART_CLIPBOARD = null; // { regionKey, label, imageData: ImageData }

        function flipImageDataH(img) {
            const { width: w, height: h, data } = img;
            const out = new ImageData(w, h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
                out.data[d] = data[s]; out.data[d+1] = data[s+1]; out.data[d+2] = data[s+2]; out.data[d+3] = data[s+3];
            }
            return out;
        }
        function flipImageDataV(img) {
            const { width: w, height: h, data } = img;
            const out = new ImageData(w, h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const s = (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4;
                out.data[d] = data[s]; out.data[d+1] = data[s+1]; out.data[d+2] = data[s+2]; out.data[d+3] = data[s+3];
            }
            return out;
        }
        function rotateImageData180(img) {
            const { width: w, height: h, data } = img;
            const out = new ImageData(w, h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const s = (y * w + x) * 4, d = ((h - 1 - y) * w + (w - 1 - x)) * 4;
                out.data[d] = data[s]; out.data[d+1] = data[s+1]; out.data[d+2] = data[s+2]; out.data[d+3] = data[s+3];
            }
            return out;
        }
        function rotateImageData90(img) {
            const { width: w, height: h, data } = img;
            const out = new ImageData(h, w); // dimensões trocadas
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const s = (y * w + x) * 4;
                const nx = h - 1 - y, ny = x;
                const d = (ny * h + nx) * 4;
                out.data[d] = data[s]; out.data[d+1] = data[s+1]; out.data[d+2] = data[s+2]; out.data[d+3] = data[s+3];
            }
            return out;
        }

        function updateClipboardStatus(suffix = '') {
            const el = document.getElementById('clipboard-status');
            const section = document.getElementById('clipboard-transform-section');
            if (!PART_CLIPBOARD) {
                if (el) { el.textContent = 'vazio'; el.className = 'text-[10px] text-slate-600 italic'; }
                if (section) section.classList.add('hidden');
                return;
            }
            if (el) { el.textContent = PART_CLIPBOARD.label + suffix; el.className = 'text-[10px] text-emerald-400 font-semibold'; }
            if (section) section.classList.remove('hidden');
        }

        function copyPartToClipboard(regionKey) {
            const region = REGIONS_INFO.find(r => r.key === regionKey);
            if (!region) return;
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            PART_CLIPBOARD = {
                regionKey,
                label: region.label,
                imageData: activeLayer.ctx.getImageData(region.x, region.y, region.w, region.h)
            };
            updateClipboardStatus();
            showToast(`"${region.label}" copiado`, 'success');
        }

        function pasteClipboardToRegion(destKey) {
            if (!PART_CLIPBOARD) { showToast('Copie uma parte primeiro', 'warning'); return; }
            const dest = REGIONS_INFO.find(r => r.key === destKey);
            if (!dest) return;
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const clip = PART_CLIPBOARD.imageData;
            const copyW = Math.min(clip.width, dest.w);
            const copyH = Math.min(clip.height, dest.h);
            const destImgData = activeLayer.ctx.getImageData(dest.x, dest.y, copyW, copyH);
            for (let y = 0; y < copyH; y++) {
                for (let x = 0; x < copyW; x++) {
                    const s = (y * clip.width + x) * 4, d = (y * copyW + x) * 4;
                    destImgData.data[d] = clip.data[s]; destImgData.data[d+1] = clip.data[s+1];
                    destImgData.data[d+2] = clip.data[s+2]; destImgData.data[d+3] = clip.data[s+3];
                }
            }
            activeLayer.ctx.putImageData(destImgData, dest.x, dest.y);
            render2DCanvas();
            saveHistoryState();
            showToast(`Colado em "${dest.label}"`, 'success');
            togglePopover('popover-copypaste');
        }

        function initCopyPasteUI() {
            const mirrorList = document.getElementById('mirror-part-list');
            if (mirrorList) {
                mirrorList.innerHTML = '';
                MIRROR_PART_BUTTONS.forEach(item => {
                    const btn = document.createElement('button');
                    btn.className = 'flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-300 text-left transition w-full';
                    btn.innerHTML = `<i class="fa-solid fa-arrows-left-right text-cyan-400 w-4 text-center"></i> ${item.label}`;
                    btn.addEventListener('click', (e) => { e.stopPropagation(); mirrorPartUV(item.from); togglePopover('popover-copypaste'); });
                    mirrorList.appendChild(btn);
                });
            }

            const copyList = document.getElementById('copy-part-list');
            if (copyList) {
                copyList.innerHTML = '';
                REGIONS_INFO.forEach(region => {
                    const btn = document.createElement('button');
                    btn.className = 'flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-300 text-left transition w-full';
                    btn.innerHTML = `<span class="legend-swatch" style="background-color: ${region.swatch};"></span> ${region.label}`;
                    btn.addEventListener('click', (e) => { e.stopPropagation(); copyPartToClipboard(region.key); });
                    copyList.appendChild(btn);
                });
            }

            const pasteList = document.getElementById('paste-part-list');
            if (pasteList) {
                pasteList.innerHTML = '';
                REGIONS_INFO.forEach(region => {
                    const btn = document.createElement('button');
                    btn.className = 'flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-300 text-left transition w-full';
                    btn.innerHTML = `<span class="legend-swatch" style="background-color: ${region.swatch};"></span> ${region.label}`;
                    btn.addEventListener('click', (e) => { e.stopPropagation(); pasteClipboardToRegion(region.key); });
                    pasteList.appendChild(btn);
                });
            }

            updateClipboardStatus();
        }

        document.getElementById('btn-clip-flip-h')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!PART_CLIPBOARD) return;
            PART_CLIPBOARD.imageData = flipImageDataH(PART_CLIPBOARD.imageData);
            updateClipboardStatus(' (espelho H)');
        });
        document.getElementById('btn-clip-flip-v')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!PART_CLIPBOARD) return;
            PART_CLIPBOARD.imageData = flipImageDataV(PART_CLIPBOARD.imageData);
            updateClipboardStatus(' (espelho V)');
        });
        document.getElementById('btn-clip-rotate-90')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!PART_CLIPBOARD) return;
            PART_CLIPBOARD.imageData = rotateImageData90(PART_CLIPBOARD.imageData);
            updateClipboardStatus(' (girado 90°)');
        });
        document.getElementById('btn-clip-rotate-180')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!PART_CLIPBOARD) return;
            PART_CLIPBOARD.imageData = rotateImageData180(PART_CLIPBOARD.imageData);
            updateClipboardStatus(' (girado 180°)');
        });

        // --- UTILITÁRIOS DE TEXTURA ---

        function getActiveLayerPixels() {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return null;
            return activeLayer.ctx.getImageData(0, 0, 64, 64);
        }

        document.getElementById('btn-util-count-colors')?.addEventListener('click', () => {
            const img = getActiveLayerPixels();
            if (!img) return;
            const unique = new Set();
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                unique.add(`${d[i]},${d[i+1]},${d[i+2]}`);
            }
            showToast(`${unique.size} cores únicas na camada ativa`, 'info');
            togglePopover('popover-utils');
        });

        document.getElementById('btn-util-transparency')?.addEventListener('click', () => {
            const img = getActiveLayerPixels();
            if (!img) return;
            const d = img.data;
            let total = 0, transparent = 0;
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    if (!isPixelInScope(x, y)) continue;
                    total++;
                    if (d[(y * 64 + x) * 4 + 3] === 0) transparent++;
                }
            }
            const pct = total > 0 ? Math.round((transparent / total) * 100) : 0;
            showToast(`${transparent} de ${total} pixels vazios (${pct}%) na região analisada`, 'info');
            togglePopover('popover-utils');
        });

        document.getElementById('btn-util-empty-overlays')?.addEventListener('click', () => {
            const emptyLayers = [];
            State.layers.forEach(layer => {
                const img = layer.ctx.getImageData(0, 0, 64, 64);
                const d = img.data;
                let hasOverlayContent = false;
                for (let y = 0; y < 64 && !hasOverlayContent; y++) {
                    for (let x = 0; x < 64; x++) {
                        if (!checkPixelRegion(x, y, 'overlay')) continue;
                        if (d[(y * 64 + x) * 4 + 3] !== 0) { hasOverlayContent = true; break; }
                    }
                }
                if (!hasOverlayContent) emptyLayers.push(layer.name);
            });
            showToast(emptyLayers.length ? `Overlay vazio em: ${emptyLayers.join(', ')}` : 'Todas as camadas têm algo no overlay', 'info');
            togglePopover('popover-utils');
        });

        document.getElementById('btn-util-duplicate-colors')?.addEventListener('click', () => {
            const img = getActiveLayerPixels();
            if (!img) return;
            const d = img.data;
            const colors = new Set();
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                colors.add(`${d[i]},${d[i+1]},${d[i+2]}`);
            }
            const list = [...colors].map(c => c.split(',').map(Number));
            let pairs = 0;
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const dist = Math.abs(list[i][0]-list[j][0]) + Math.abs(list[i][1]-list[j][1]) + Math.abs(list[i][2]-list[j][2]);
                    if (dist > 0 && dist <= 12) pairs++;
                }
            }
            showToast(pairs > 0 ? `${pairs} par(es) de cores muito parecidas encontrados` : 'Nenhuma cor parecida encontrada', 'info');
            togglePopover('popover-utils');
        });

        function findExtremePixel(mode) {
            const img = getActiveLayerPixels();
            if (!img) return;
            const d = img.data;
            let best = null, bestLum = mode === 'brightest' ? -1 : 256;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                const lum = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
                if ((mode === 'brightest' && lum > bestLum) || (mode === 'darkest' && lum < bestLum)) {
                    bestLum = lum;
                    best = [d[i], d[i+1], d[i+2]];
                }
            }
            if (!best) { showToast('Camada ativa está vazia', 'warning'); return; }
            const hex = rgbToHex(best[0], best[1], best[2]);
            setCurrentColor(hex);
            showToast(`Pixel mais ${mode === 'brightest' ? 'claro' : 'escuro'}: ${hex.toUpperCase()} (definido como cor atual)`, 'success');
        }
        document.getElementById('btn-util-brightest')?.addEventListener('click', () => { findExtremePixel('brightest'); togglePopover('popover-utils'); });
        document.getElementById('btn-util-darkest')?.addEventListener('click', () => { findExtremePixel('darkest'); togglePopover('popover-utils'); });

        // Apaga pixels da camada ativa que estão 100% cobertos por camadas visíveis e
        // totalmente opacas acima dela — não têm efeito nenhum no resultado final.
        document.getElementById('btn-util-remove-unused')?.addEventListener('click', () => {
            const activeIdx = State.activeLayerIndex;
            const activeLayer = State.layers[activeIdx];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); togglePopover('popover-utils'); return; }

            const layersAbove = State.layers.slice(activeIdx + 1).filter(l => l.visible && (l.opacity === undefined || l.opacity >= 0.99));
            if (layersAbove.length === 0) {
                showToast('Nenhuma camada totalmente opaca acima para comparar', 'info');
                togglePopover('popover-utils');
                return;
            }

            const aboveData = layersAbove.map(l => l.ctx.getImageData(0, 0, 64, 64).data);
            const img = activeLayer.ctx.getImageData(0, 0, 64, 64);
            const d = img.data;
            let removed = 0;

            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                const covered = aboveData.some(ad => ad[i + 3] === 255);
                if (covered) { d[i + 3] = 0; removed++; }
            }

            if (removed === 0) {
                showToast('Nenhum pixel oculto encontrado', 'info');
                togglePopover('popover-utils');
                return;
            }
            activeLayer.ctx.putImageData(img, 0, 0);
            render2DCanvas();
            renderLayerUI();
            saveHistoryState();
            showToast(`${removed} pixel(is) oculto(s) removido(s) da camada ativa`, 'success');
            togglePopover('popover-utils');
        });

        // Quantização por popularidade: mantém as N cores mais usadas e remapeia o resto
        // para a cor mais próxima entre essas N (distância euclidiana em RGB).
        document.getElementById('btn-util-quantize')?.addEventListener('click', () => {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }

            const n = Math.max(2, Math.min(32, parseInt(document.getElementById('input-quantize-count').value) || 8));
            const ctx = activeLayer.ctx;
            const img = ctx.getImageData(0, 0, 64, 64);
            const d = img.data;

            const freq = new Map();
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                const key = `${d[i]},${d[i+1]},${d[i+2]}`;
                freq.set(key, (freq.get(key) || 0) + 1);
            }
            if (freq.size <= n) { showToast('A camada já tem poucas cores — nada a fazer', 'info'); togglePopover('popover-utils'); return; }

            const palette = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k.split(',').map(Number));

            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                let bestIdx = 0, bestDist = Infinity;
                for (let p = 0; p < palette.length; p++) {
                    const dist = (d[i]-palette[p][0])**2 + (d[i+1]-palette[p][1])**2 + (d[i+2]-palette[p][2])**2;
                    if (dist < bestDist) { bestDist = dist; bestIdx = p; }
                }
                d[i] = palette[bestIdx][0]; d[i+1] = palette[bestIdx][1]; d[i+2] = palette[bestIdx][2];
            }
            ctx.putImageData(img, 0, 0);
            render2DCanvas();
            saveHistoryState();
            showToast(`Camada quantizada para ${n} cores`, 'success');
            togglePopover('popover-utils');
        });

        function initLayers() {
            const baseLayer = createLayerObject('Camada Base (Corpo)');
            createDefaultSkinBase(baseLayer.ctx); // Preenche a base para não ficar invisível!

            State.layers = [
                baseLayer,
                createLayerObject('Armadura / Roupas (Overlay)')
            ];
            State.activeLayerIndex = 0;
            renderLayerUI();
            render2DCanvas();
            saveHistoryState();
        }

        function render2DCanvas() {
            ctx2D.clearRect(0, 0, 64, 64);

            State.layers.forEach(layer => {
                if (layer.visible) {
                    ctx2D.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                    
                    if (activeIsolatedRegion === 'all' && !activeFaceSelection) {
                        ctx2D.drawImage(layer.canvas, 0, 0);
                    } else {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = 64;
                        tempCanvas.height = 64;
                        const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                        tCtx.drawImage(layer.canvas, 0, 0);

                        const imgData = tCtx.getImageData(0, 0, 64, 64);
                        const d = imgData.data;

                        for (let y = 0; y < 64; y++) {
                            for (let x = 0; x < 64; x++) {
                                const isMatch = isPixelInScope(x, y);
                                const idx = (y * 64 + x) * 4;
                                if (!isMatch) {
                                    d[idx + 3] = 0;
                                }
                            }
                        }
                        tCtx.putImageData(imgData, 0, 0);
                        ctx2D.drawImage(tempCanvas, 0, 0);
                    }
                }
            });
            ctx2D.globalAlpha = 1.0;

            if (threeTexture) {
                threeTexture.needsUpdate = true;
            }

            drawOverlayGrid();
        }

        function checkPixelRegion(x, y, region) {
            const isOverlay = (
                (x >= 32 && y < 16) || // Chapéu
                (x >= 16 && x < 40 && y >= 32 && y < 48) || // Casaco (Tronco)
                (x >= 40 && x < 56 && y >= 32 && y < 48) || // Manga Direita
                (x >= 48 && x < 64 && y >= 48 && y < 64) || // Manga Esquerda
                (x >= 0 && x < 16 && y >= 32 && y < 48) || // Perna Direita (Overlay)
                (x >= 0 && x < 16 && y >= 48 && y < 64)    // Perna Esquerda (Overlay)
            );

            if (region === 'overlay') return isOverlay;
            if (region === 'base') return !isOverlay;

            if (region === 'head') return (y < 16 && x < 32) || (y < 16 && x >= 32); // Inclui cabeça base e overlay
            
            // Atualizado body para incluir overlay corretamente
            if (region === 'body') return (x >= 16 && x < 40 && y >= 16 && y < 32) || (x >= 16 && x < 40 && y >= 32 && y < 48);
            
            if (region === 'limbs') {
                const isLimbBase = (
                    (x >= 40 && x < 56 && y >= 16 && y < 32) || // Braço Direito
                    (x >= 32 && x < 48 && y >= 48 && y < 64) || // Braço Esquerdo
                    (x >= 0 && x < 16 && y >= 16 && y < 32) || // Perna Direita
                    (x >= 16 && x < 32 && y >= 48 && y < 64)    // Perna Esquerda
                );
                const isLimbOverlay = (
                    (x >= 40 && x < 56 && y >= 32 && y < 48) || // Braço Dir Overlay
                    (x >= 48 && x < 64 && y >= 48 && y < 64) || // Braço Esq Overlay
                    (x >= 0 && x < 16 && y >= 32 && y < 48) || // Perna Dir Overlay
                    (x >= 0 && x < 16 && y >= 48 && y < 64)    // Perna Esq Overlay
                );
                return isLimbBase || isLimbOverlay;
            }

            return true;
        }

        function renderLayerUI() {
            const listEl = document.getElementById('layers-list');
            if (!listEl) return;

            // Qualquer menu "⋮" que tenha sido movido pro <body> (ver btn-layer-more)
            // precisa sumir antes de reconstruir a lista, ou fica orfão com dados
            // antigos (camada errada) flutuando na tela.
            document.querySelectorAll('body > .layer-more-menu').forEach(m => m.remove());

            listEl.innerHTML = '';

            [...State.layers].reverse().forEach((layer, revIdx) => {
                const realIdx = State.layers.length - 1 - revIdx;
                const isActive = realIdx === State.activeLayerIndex;

                const item = document.createElement('div');
                item.className = `layer-item p-2.5 rounded-xl border border-slate-800 bg-slate-900 flex flex-col gap-2 transition ${isActive ? 'active' : 'hover:border-slate-700'}`;

                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 32;
                thumbCanvas.height = 32;
                thumbCanvas.className = 'w-7 h-7 rounded checkerboard border border-slate-700 shrink-0';
                const tCtx = thumbCanvas.getContext('2d');
                tCtx.imageSmoothingEnabled = false;
                tCtx.drawImage(layer.canvas, 0, 0, 32, 32);

                const opacityPct = Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100);

                item.innerHTML = `
                    <div class="flex items-center justify-between gap-1.5">
                        <div class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer btn-select-layer">
                            ${thumbCanvas.outerHTML}
                            <span class="text-xs font-semibold text-slate-200 truncate layer-name">${layer.name}</span>
                        </div>

                        <div class="flex items-center gap-0.5 shrink-0">
                            <button class="btn-move-up text-slate-400 hover:text-white p-1" title="Subir">
                                <i class="fa-solid fa-chevron-up text-[10px]"></i>
                            </button>
                            <button class="btn-move-down text-slate-400 hover:text-white p-1" title="Descer">
                                <i class="fa-solid fa-chevron-down text-[10px]"></i>
                            </button>
                            
                            <button class="btn-rename text-slate-400 hover:text-blue-400 p-1" title="Renomear">
                                <i class="fa-solid fa-pen text-xs"></i>
                            </button>
                            <button class="btn-duplicate-layer text-slate-400 hover:text-emerald-400 p-1" title="Duplicar">
                                <i class="fa-solid fa-clone text-xs"></i>
                            </button>
                            <button class="btn-toggle-vis text-${layer.visible ? 'indigo-400' : 'slate-600'} hover:text-indigo-300 p-1" title="Visibilidade">
                                <i class="fa-solid fa-${layer.visible ? 'eye' : 'eye-slash'} text-xs"></i>
                            </button>
                            <button class="btn-toggle-lock text-${layer.locked ? 'amber-400' : 'slate-600'} hover:text-amber-300 p-1" title="Bloquear">
                                <i class="fa-solid fa-${layer.locked ? 'lock' : 'lock-open'} text-xs"></i>
                            </button>
                            <button class="btn-delete-layer text-slate-500 hover:text-red-400 p-1" title="Excluir">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                            <div class="relative">
                                <button class="btn-layer-more text-slate-500 hover:text-white p-1" title="Mais opções">
                                    <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                                </button>
                                <div class="layer-more-menu hidden absolute top-full right-0 mt-1 p-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-44 flex flex-col gap-0.5 z-30">
                                    <button class="btn-merge-down flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded-lg text-[11px] text-slate-300 text-left transition ${realIdx === 0 ? 'opacity-40 pointer-events-none' : ''}">
                                        <i class="fa-solid fa-down-left-and-up-right-to-center text-indigo-400 w-3.5"></i> Mesclar com a de baixo
                                    </button>
                                    <button class="btn-clear-layer flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded-lg text-[11px] text-slate-300 text-left transition">
                                        <i class="fa-solid fa-broom text-amber-400 w-3.5"></i> Limpar Camada
                                    </button>
                                    <button class="btn-export-layer flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded-lg text-[11px] text-slate-300 text-left transition">
                                        <i class="fa-solid fa-file-export text-emerald-400 w-3.5"></i> Exportar PNG
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 pt-1 border-t border-slate-800/80 text-[10px] text-slate-400">
                        <span>Opacidade:</span>
                        <input type="range" min="0" max="100" value="${opacityPct}" class="layer-opacity-slider flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500">
                        <span class="opacity-label font-bold text-slate-300 w-7 text-right">${opacityPct}%</span>
                    </div>
                `;

                item.querySelector('.btn-select-layer').addEventListener('click', () => {
                    State.activeLayerIndex = realIdx;
                    renderLayerUI();
                });

                item.querySelector('.btn-move-up').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (realIdx < State.layers.length - 1) {
                        const temp = State.layers[realIdx];
                        State.layers[realIdx] = State.layers[realIdx + 1];
                        State.layers[realIdx + 1] = temp;
                        if (State.activeLayerIndex === realIdx) State.activeLayerIndex = realIdx + 1;
                        else if (State.activeLayerIndex === realIdx + 1) State.activeLayerIndex = realIdx;
                        renderLayerUI();
                        render2DCanvas();
                        saveHistoryState();
                    }
                });

                item.querySelector('.btn-move-down').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (realIdx > 0) {
                        const temp = State.layers[realIdx];
                        State.layers[realIdx] = State.layers[realIdx - 1];
                        State.layers[realIdx - 1] = temp;
                        if (State.activeLayerIndex === realIdx) State.activeLayerIndex = realIdx - 1;
                        else if (State.activeLayerIndex === realIdx - 1) State.activeLayerIndex = realIdx;
                        renderLayerUI();
                        render2DCanvas();
                        saveHistoryState();
                    }
                });

                item.querySelector('.layer-opacity-slider').addEventListener('input', (e) => {
                    const val = parseInt(e.target.value);
                    layer.opacity = val / 100;
                    item.querySelector('.opacity-label').textContent = `${val}%`;
                    render2DCanvas();
                });

                item.querySelector('.layer-opacity-slider').addEventListener('change', () => {
                    saveHistoryState();
                });

                item.querySelector('.btn-toggle-vis').addEventListener('click', (e) => {
                    e.stopPropagation();
                    layer.visible = !layer.visible;
                    renderLayerUI();
                    render2DCanvas();
                    saveHistoryState();
                });

                item.querySelector('.btn-toggle-lock').addEventListener('click', (e) => {
                    e.stopPropagation();
                    layer.locked = !layer.locked;
                    renderLayerUI();
                });

                item.querySelector('.btn-rename').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showRenameModal(layer.name, (newName) => {
                        layer.name = newName;
                        renderLayerUI();
                        saveToBrowserStorage();
                    });
                });

                item.querySelector('.btn-duplicate-layer').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const imgData = layer.ctx.getImageData(0, 0, 64, 64);
                    const newLayer = createLayerObject(`${layer.name} (Cópia)`, imgData);
                    State.layers.splice(realIdx + 1, 0, newLayer);
                    State.activeLayerIndex = realIdx + 1;
                    renderLayerUI();
                    render2DCanvas();
                    saveHistoryState();
                    showToast(`Camada "${layer.name}" duplicada`, 'success');
                });

                item.querySelector('.btn-delete-layer').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (State.layers.length <= 1) {
                        showToast('Mantenha pelo menos uma camada!', 'warning');
                        return;
                    }
                    showConfirmModal(
                        'Excluir camada',
                        `Tem certeza que deseja excluir a camada "${layer.name}"? Essa ação pode ser desfeita com Ctrl+Z.`,
                        () => {
                            State.layers.splice(realIdx, 1);
                            if (State.activeLayerIndex >= State.layers.length) {
                                State.activeLayerIndex = State.layers.length - 1;
                            }
                            renderLayerUI();
                            render2DCanvas();
                            saveHistoryState();
                        },
                        { confirmLabel: 'Excluir' }
                    );
                });

                item.querySelector('.btn-layer-more').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = item.querySelector('.layer-more-menu');
                    const wasHidden = menu.classList.contains('hidden');
                    document.querySelectorAll('.layer-more-menu').forEach(m => m.classList.add('hidden'));
                    if (wasHidden) {
                        // Mesma correção dos popovers: a lista de camadas rola dentro de um
                        // container com overflow, então esse menu também precisa "escapar"
                        // pro body pra não ficar cortado.
                        menu.classList.remove('absolute');
                        menu.classList.add('fixed');
                        menu.style.margin = '0';
                        menu.style.right = 'auto';
                        document.body.appendChild(menu);
                        const rect = e.currentTarget.getBoundingClientRect();
                        menu.style.left = `${Math.max(8, rect.right - 176)}px`; // w-44 = 176px
                        menu.style.top = `${rect.bottom + 4}px`;
                        menu.classList.remove('hidden');
                    }
                });

                item.querySelector('.btn-merge-down').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (realIdx === 0) return;
                    const below = State.layers[realIdx - 1];
                    if (below.locked) {
                        showToast('A camada de baixo está bloqueada!', 'warning');
                        return;
                    }
                    below.ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                    below.ctx.drawImage(layer.canvas, 0, 0);
                    below.ctx.globalAlpha = 1;
                    State.layers.splice(realIdx, 1);
                    State.activeLayerIndex = realIdx - 1;
                    renderLayerUI();
                    render2DCanvas();
                    saveHistoryState();
                    showToast(`"${layer.name}" mesclada com "${below.name}"`, 'success');
                });

                item.querySelector('.btn-clear-layer').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (layer.locked) {
                        showToast('Camada bloqueada! Destrave para limpar.', 'warning');
                        return;
                    }
                    showConfirmModal(
                        'Limpar camada',
                        `Apagar todo o conteúdo da camada "${layer.name}"? Essa ação pode ser desfeita com Ctrl+Z.`,
                        () => {
                            layer.ctx.clearRect(0, 0, 64, 64);
                            renderLayerUI();
                            render2DCanvas();
                            saveHistoryState();
                            showToast(`Camada "${layer.name}" limpa`, 'success');
                        },
                        { confirmLabel: 'Limpar' }
                    );
                });

                item.querySelector('.btn-export-layer').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const link = document.createElement('a');
                    link.download = `${layer.name.replace(/[^a-z0-9_\-]/gi, '_')}.png`;
                    link.href = layer.canvas.toDataURL('image/png');
                    link.click();
                    showToast(`Camada "${layer.name}" exportada`, 'success');
                });

                listEl.appendChild(item);
            });
        }

        function saveHistoryState() {
            if (State.historyIndex < State.history.length - 1) {
                State.history = State.history.slice(0, State.historyIndex + 1);
            }

            const layerSnapshots = State.layers.map(l => ({
                id: l.id,
                name: l.name,
                visible: l.visible,
                locked: l.locked,
                opacity: l.opacity,
                data: l.ctx.getImageData(0, 0, 64, 64)
            }));

            State.history.push(layerSnapshots);
            if (State.history.length > 30) {
                State.history.shift();
            } else {
                State.historyIndex++;
            }

            saveToBrowserStorage();
            markUnsavedChanges();
        }

        function markUnsavedChanges() {
            State.hasUnsavedChanges = true;
            document.getElementById('unsaved-changes-dot')?.classList.remove('hidden');
        }
        function markChangesSaved() {
            State.hasUnsavedChanges = false;
            document.getElementById('unsaved-changes-dot')?.classList.add('hidden');
        }
        // OBS: propositalmente SEM listener de 'beforeunload' bloqueando o fechamento da aba.
        // Como saveHistoryState() já roda o autosave (saveToBrowserStorage) a cada edição, o
        // trabalho nunca fica de fato em risco — só o ponto indicador acima avisa visualmente
        // que ainda não foi salvo como Projeto nomeado / exportado. Um diálogo de confirmação
        // apareceria a cada fechamento de aba após qualquer traço, o que é mais incômodo do
        // que útil quando não há perda real de dados em jogo.

        function undo() {
            if (State.historyIndex > 0) {
                State.historyIndex--;
                restoreHistoryState(State.history[State.historyIndex]);
                showToast('Desfeito', 'info');
            }
        }

        function redo() {
            if (State.historyIndex < State.history.length - 1) {
                State.historyIndex++;
                restoreHistoryState(State.history[State.historyIndex]);
                showToast('Reffeito', 'info');
            }
        }

        function restoreHistoryState(snapshot) {
            State.layers = snapshot.map(s => {
                const layerObj = createLayerObject(s.name, s.data);
                layerObj.id = s.id;
                layerObj.visible = s.visible;
                layerObj.locked = s.locked;
                layerObj.opacity = s.opacity;
                return layerObj;
            });
            if (State.activeLayerIndex >= State.layers.length) {
                State.activeLayerIndex = State.layers.length - 1;
            }
            renderLayerUI();
            render2DCanvas();
        }

        document.getElementById('btn-undo')?.addEventListener('click', undo);
        document.getElementById('btn-redo')?.addEventListener('click', redo);

        // --- SELEÇÃO DE FACE (Seção 13) ---
        function showFaceSelectionBanner(face) {
            const banner = document.getElementById('face-selection-banner');
            const label = document.getElementById('face-selection-label');
            if (label) label.textContent = `${face.label} (${face.rect.w}×${face.rect.h}px)`;
            if (banner) { banner.classList.remove('hidden'); banner.classList.add('flex'); }
        }
        function clearFaceSelection() {
            activeFaceSelection = null;
            const banner = document.getElementById('face-selection-banner');
            if (banner) { banner.classList.add('hidden'); banner.classList.remove('flex'); }
            render2DCanvas();
        }
        document.getElementById('btn-clear-face-selection')?.addEventListener('click', clearFaceSelection);

        document.getElementById('btn-toggle-face-select')?.addEventListener('click', (e) => {
            State.faceSelectMode = !State.faceSelectMode;
            const btn = e.currentTarget;
            btn.classList.toggle('bg-cyan-600/90', State.faceSelectMode);
            btn.classList.toggle('border-cyan-500/50', State.faceSelectMode);
            btn.classList.toggle('bg-slate-900/90', !State.faceSelectMode);
            showToast(State.faceSelectMode ? 'Clique numa face do personagem 3D para selecioná-la' : 'Seleção de face desativada', 'info');
        });

        document.querySelectorAll('.region-menu-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.region-menu-item').forEach(b => {
                    b.classList.remove('active', 'bg-slate-800/50');
                    b.querySelector('.check-icon').classList.add('hidden');
                });
                btn.classList.add('active', 'bg-slate-800/50');
                btn.querySelector('.check-icon').classList.remove('hidden');
                
                activeIsolatedRegion = btn.dataset.region;
                if (activeFaceSelection) clearFaceSelection();
                render2DCanvas();
                update3DModelVisibility();
                showToast(`Visibilidade: ${btn.querySelector('span').textContent}`, 'info');
                togglePopover('popover-view2d'); 
            });
        });

        // --- MODO DE SIMETRIA ---
        document.querySelectorAll('.symmetry-mode-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.symmetry-mode-item').forEach(b => {
                    b.classList.remove('active', 'bg-slate-800/50');
                    b.querySelector('.check-icon').classList.add('hidden');
                });
                btn.classList.add('active', 'bg-slate-800/50');
                btn.querySelector('.check-icon').classList.remove('hidden');

                State.symmetryMode = btn.dataset.symmetry;
                const badge = document.getElementById('symmetry-badge');
                if (badge) badge.classList.toggle('hidden', State.symmetryMode === 'off');
                showToast(`Simetria: ${btn.querySelector('span').textContent}`, 'info');
                togglePopover('popover-symmetry');
            });
        });

        // --- ANIMAÇÕES 3D ---
        const ANIMATION_LABELS = { none: 'Animação', idle: 'Idle', walk: 'Andar', run: 'Correr', sneak: 'Agachar', jump: 'Pular', attack: 'Atacar', wave: 'Acenar' };

        // Calcula a pose (rotações em radianos + deslocamento vertical do corpo) para cada
        // animação, dado o tempo decorrido `t` em segundos. Tudo procedural (seno/cosseno),
        // sem necessidade de arquivos de animação externos.
        function computeAnimationPose(name, t) {
            const pose = { armR: 0, armL: 0, legR: 0, legL: 0, bodyY: 0 };
            switch (name) {
                case 'idle':
                    pose.armR = Math.sin(t * 1.5) * 0.06;
                    pose.armL = -Math.sin(t * 1.5) * 0.06;
                    pose.bodyY = Math.sin(t * 1.5) * 0.1;
                    break;
                case 'walk':
                    pose.armR = Math.sin(t * 4) * 0.6;
                    pose.armL = -Math.sin(t * 4) * 0.6;
                    pose.legR = -Math.sin(t * 4) * 0.6;
                    pose.legL = Math.sin(t * 4) * 0.6;
                    pose.bodyY = Math.abs(Math.sin(t * 4)) * 0.3;
                    break;
                case 'run':
                    pose.armR = Math.sin(t * 7.5) * 1.1;
                    pose.armL = -Math.sin(t * 7.5) * 1.1;
                    pose.legR = -Math.sin(t * 7.5) * 1.2;
                    pose.legL = Math.sin(t * 7.5) * 1.2;
                    pose.bodyY = Math.abs(Math.sin(t * 7.5)) * 0.6;
                    break;
                case 'sneak':
                    pose.armR = Math.sin(t * 3) * 0.3 + 0.2;
                    pose.armL = -Math.sin(t * 3) * 0.3 + 0.2;
                    pose.legR = -Math.sin(t * 3) * 0.35;
                    pose.legL = Math.sin(t * 3) * 0.35;
                    pose.bodyY = -1.6;
                    break;
                case 'jump': {
                    const cycle = Math.abs(Math.sin(t * 1.8));
                    pose.armR = -0.6 - cycle * 0.3;
                    pose.armL = -0.6 - cycle * 0.3;
                    pose.legR = 0.35;
                    pose.legL = 0.35;
                    pose.bodyY = cycle * 2.2;
                    break;
                }
                case 'attack':
                    pose.armR = -1.4 + Math.max(0, Math.sin(t * 6)) * 1.1;
                    pose.legR = Math.sin(t * 6) * 0.15;
                    pose.legL = -Math.sin(t * 6) * 0.15;
                    break;
                case 'wave':
                    pose.armL = -2.7 + Math.sin(t * 6) * 0.35;
                    break;
            }
            return pose;
        }

        document.querySelectorAll('.animation-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.animation-item').forEach(b => {
                    b.classList.remove('active', 'bg-slate-800/50');
                    b.querySelector('.check-icon').classList.add('hidden');
                });
                btn.classList.add('active', 'bg-slate-800/50');
                btn.querySelector('.check-icon').classList.remove('hidden');

                State.currentAnimation = btn.dataset.anim;
                const label = document.getElementById('label-current-animation');
                if (label) label.textContent = ANIMATION_LABELS[State.currentAnimation] || 'Animação';

                // Volta à pose neutra imediatamente ao desligar a animação.
                if (State.currentAnimation === 'none' && limbPivots.armR) {
                    ['armR', 'armL', 'legR', 'legL'].forEach(k => { limbPivots[k].rotation.x = 0; });
                    if (playerGroup) playerGroup.position.y = 0;
                }
                showToast(`Animação: ${btn.querySelector('span').textContent}`, 'info');
                togglePopover('popover-animation');
            });
        });

        function setModelType(type, silent = false) {
            State.modelType = type;
            const lbl = document.getElementById('label-model-type');
            if (lbl) lbl.textContent = `Modelo: ${type === 'classic' ? 'Classic' : 'Slim'}`;
            buildPlayerModel();
            if (!silent) showToast(`Modelo alterado para: ${type === 'classic' ? 'Steve (4px)' : 'Alex (3px)'}`, 'success');
        }

        document.getElementById('btn-toggle-model')?.addEventListener('click', () => {
            setModelType(State.modelType === 'classic' ? 'slim' : 'classic');
        });

        function addLayerWithName(name) {
            const newLayer = createLayerObject(name);
            State.layers.push(newLayer);
            State.activeLayerIndex = State.layers.length - 1;
            renderLayerUI();
            render2DCanvas();
            saveHistoryState();
            showToast(`Camada "${name}" adicionada!`, 'success');
        }

        document.querySelectorAll('.new-layer-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                addLayerWithName(btn.dataset.preset);
                togglePopover('popover-new-layer');
            });
        });

        document.getElementById('btn-new-layer-custom')?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover('popover-new-layer');
            showRenameModal(`Camada ${State.layers.length + 1}`, (name) => addLayerWithName(name));
        });

        // --- UTILITÁRIOS DE COR (conversões HEX ↔ RGB ↔ HSL) ---
        function hexToRgb(hex) {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
            return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
        }
        function rgbToHex(r, g, b) {
            const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
            return `#${c(r)}${c(g)}${c(b)}`;
        }
        function rgbToHsl(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) { h = s = 0; }
            else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    default: h = (r - g) / d + 4;
                }
                h /= 6;
            }
            return { h: h * 360, s: s * 100, l: l * 100 };
        }
        function hslToRgb(h, s, l) {
            h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
            let r, g, b;
            if (s === 0) { r = g = b = l; }
            else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1 / 3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1 / 3);
            }
            return { r: r * 255, g: g * 255, b: b * 255 };
        }
        function hexToHsl(hex) { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); }
        function hslToHex(h, s, l) { const { r, g, b } = hslToRgb(h, s, l); return rgbToHex(r, g, b); }

        function initPalette() {
            const paletteGrid = document.getElementById('palette-grid');
            if (!paletteGrid) return;
            paletteGrid.innerHTML = '';
            State.palette.forEach(color => {
                const btn = document.createElement('button');
                btn.className = 'w-6 h-6 rounded-md border border-slate-700/80 hover:scale-110 transition shadow-sm';
                btn.style.backgroundColor = color;
                btn.title = color;
                btn.addEventListener('click', () => {
                    setCurrentColor(color);
                });
                paletteGrid.appendChild(btn);
            });
        }

        let ironPicker = null; // instância lazy do iro.js (só criada quando o Estúdio de Cores abre)
        let suppressColorSync = false; // evita loop infinito ao sincronizar os campos entre si

        // Atualiza o estado de cor + todos os elementos visuais (picker, hex, estúdio de
        // cores se estiver aberto) de uma só vez, e registra a cor nas "Recentes".
        function setCurrentColor(hex, opts = {}) {
            hex = hex.toLowerCase();
            State.currentColor = hex;
            if (colorPicker) colorPicker.value = hex;

            const hexLabel = document.getElementById('current-color-hex');
            if (hexLabel) hexLabel.textContent = hex.toUpperCase();
            const primarySwatch = document.getElementById('primary-color-swatch');
            if (primarySwatch) primarySwatch.style.backgroundColor = hex;

            if (!opts.skipSync) syncColorStudioInputs(hex);
            if (!opts.skipRecent) pushRecentColor(hex);
        }

        function setSecondaryColor(hex) {
            hex = hex.toLowerCase();
            State.secondaryColor = hex;
            const swatch = document.getElementById('secondary-color-swatch');
            if (swatch) swatch.style.backgroundColor = hex;
        }

        document.getElementById('btn-swap-colors')?.addEventListener('click', () => {
            const a = State.currentColor, b = State.secondaryColor;
            setCurrentColor(b);
            setSecondaryColor(a);
        });

        colorPicker?.addEventListener('input', (e) => {
            setCurrentColor(e.target.value);
        });

        // --- CORES RECENTES ---
        function pushRecentColor(hex) {
            State.recentColors = State.recentColors.filter(c => c !== hex);
            State.recentColors.unshift(hex);
            if (State.recentColors.length > 16) State.recentColors.length = 16;
            renderRecentColors();
        }
        function renderRecentColors() {
            const row = document.getElementById('recent-colors-row');
            if (!row) return;
            row.innerHTML = '';
            State.recentColors.forEach(hex => {
                const chip = document.createElement('button');
                chip.className = 'color-chip';
                chip.style.backgroundColor = hex;
                chip.title = hex;
                chip.addEventListener('click', () => setCurrentColor(hex));
                row.appendChild(chip);
            });
        }

        // --- FAVORITOS (persistidos no navegador) ---
        function loadFavoritesFromStorage() {
            try {
                const raw = localStorage.getItem('skin_editor_favorites');
                State.favoriteColors = raw ? JSON.parse(raw) : [];
            } catch (e) { State.favoriteColors = []; }
        }
        function saveFavoritesToStorage() {
            try { localStorage.setItem('skin_editor_favorites', JSON.stringify(State.favoriteColors)); } catch (e) {}
        }
        function renderFavoriteColors() {
            const row = document.getElementById('favorite-colors-row');
            if (!row) return;
            row.innerHTML = '';
            if (State.favoriteColors.length === 0) {
                row.innerHTML = '<span class="text-[10px] text-slate-600 italic">Nenhuma cor favoritada ainda</span>';
                return;
            }
            State.favoriteColors.forEach(hex => {
                const wrap = document.createElement('div');
                wrap.className = 'relative group';
                const chip = document.createElement('button');
                chip.className = 'color-chip';
                chip.style.backgroundColor = hex;
                chip.title = hex;
                chip.addEventListener('click', () => setCurrentColor(hex));
                const removeBtn = document.createElement('button');
                removeBtn.className = 'absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 text-white text-[7px] items-center justify-center hidden group-hover:flex';
                removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                removeBtn.title = 'Remover dos favoritos';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    State.favoriteColors = State.favoriteColors.filter(c => c !== hex);
                    saveFavoritesToStorage();
                    renderFavoriteColors();
                });
                wrap.appendChild(chip);
                wrap.appendChild(removeBtn);
                row.appendChild(wrap);
            });
        }
        document.getElementById('btn-add-favorite')?.addEventListener('click', () => {
            if (!State.favoriteColors.includes(State.currentColor)) {
                State.favoriteColors.unshift(State.currentColor);
                if (State.favoriteColors.length > 24) State.favoriteColors.length = 24;
                saveFavoritesToStorage();
                renderFavoriteColors();
                showToast('Cor adicionada aos favoritos', 'success');
            } else {
                showToast('Essa cor já está nos favoritos', 'info');
            }
        });

        // --- PALETAS SALVAS (persistidas no navegador) ---
        function loadSavedPalettesFromStorage() {
            try {
                const raw = localStorage.getItem('skin_editor_palettes');
                State.savedPalettes = raw ? JSON.parse(raw) : {};
            } catch (e) { State.savedPalettes = {}; }
        }
        function saveSavedPalettesToStorage() {
            try { localStorage.setItem('skin_editor_palettes', JSON.stringify(State.savedPalettes)); } catch (e) {}
        }
        function renderSavedPalettes() {
            const list = document.getElementById('saved-palettes-list');
            if (!list) return;
            list.innerHTML = '';
            const names = Object.keys(State.savedPalettes);
            if (names.length === 0) {
                list.innerHTML = '<span class="text-[10px] text-slate-600 italic">Nenhuma paleta salva ainda</span>';
                return;
            }
            names.forEach(name => {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-1.5 bg-slate-950/60 rounded-lg px-2 py-1.5 border border-slate-800';
                const label = document.createElement('button');
                label.className = 'flex-1 flex items-center gap-1 text-[11px] text-slate-300 text-left hover:text-white transition truncate';
                label.innerHTML = `<i class="fa-solid fa-swatchbook text-indigo-400 text-[10px]"></i> ${name} <span class="text-slate-600">(${State.savedPalettes[name].length})</span>`;
                label.title = 'Carregar esta paleta na Paleta Rápida';
                label.addEventListener('click', () => {
                    State.palette = [...State.savedPalettes[name]];
                    initPalette();
                    showToast(`Paleta "${name}" carregada`, 'success');
                });
                const delBtn = document.createElement('button');
                delBtn.className = 'text-slate-600 hover:text-red-400 px-1 transition';
                delBtn.innerHTML = '<i class="fa-solid fa-trash text-[10px]"></i>';
                delBtn.addEventListener('click', () => {
                    delete State.savedPalettes[name];
                    saveSavedPalettesToStorage();
                    renderSavedPalettes();
                });
                row.appendChild(label);
                row.appendChild(delBtn);
                list.appendChild(row);
            });
        }
        function promptSavePalette(colors) {
            showRenameModal('Minha Paleta', (name) => {
                State.savedPalettes[name] = colors;
                saveSavedPalettesToStorage();
                renderSavedPalettes();
                showToast(`Paleta "${name}" salva`, 'success');
            });
        }
        document.getElementById('btn-save-current-palette')?.addEventListener('click', () => promptSavePalette([...State.palette]));

        // --- HARMONIAS DE COR ---
        function computeHarmonies(hex) {
            const { h, s, l } = hexToHsl(hex);
            return [
                { name: 'Complementar', colors: [hslToHex(h + 180, s, l)] },
                { name: 'Análoga', colors: [hslToHex(h - 30, s, l), hslToHex(h + 30, s, l)] },
                { name: 'Tríade', colors: [hslToHex(h + 120, s, l), hslToHex(h + 240, s, l)] },
                { name: 'Split-Complementar', colors: [hslToHex(h + 150, s, l), hslToHex(h + 210, s, l)] },
                { name: 'Monocromática', colors: [hslToHex(h, s, Math.max(10, l - 25)), hslToHex(h, s, Math.min(90, l + 25))] }
            ];
        }
        function renderHarmonies() {
            const list = document.getElementById('harmonies-list');
            if (!list) return;
            list.innerHTML = '';
            computeHarmonies(State.currentColor).forEach(group => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between gap-2';
                const label = document.createElement('span');
                label.className = 'text-[10px] text-slate-400 shrink-0';
                label.textContent = group.name;
                const swatches = document.createElement('div');
                swatches.className = 'flex gap-1';
                group.colors.forEach(hex => {
                    const chip = document.createElement('button');
                    chip.className = 'color-chip';
                    chip.style.backgroundColor = hex;
                    chip.title = hex;
                    chip.addEventListener('click', () => setCurrentColor(hex));
                    swatches.appendChild(chip);
                });
                row.appendChild(label);
                row.appendChild(swatches);
                list.appendChild(row);
            });
        }

        // --- GERADOR DE TONS (RAMP) ---
        function computeTonalRamp(hex, steps = 9) {
            const { h, s } = hexToHsl(hex);
            const ramp = [];
            for (let i = 0; i < steps; i++) {
                const l = 90 - (i * (80 / (steps - 1)));
                ramp.push(hslToHex(h, s, l));
            }
            return ramp;
        }
        function renderTonalRamp() {
            const row = document.getElementById('tonal-ramp-row');
            if (!row) return;
            row.innerHTML = '';
            computeTonalRamp(State.currentColor).forEach(hex => {
                const chip = document.createElement('button');
                chip.className = 'color-chip';
                chip.style.backgroundColor = hex;
                chip.title = hex;
                chip.addEventListener('click', () => setCurrentColor(hex));
                row.appendChild(chip);
            });
        }
        document.getElementById('btn-add-ramp-palette')?.addEventListener('click', () => {
            promptSavePalette(computeTonalRamp(State.currentColor));
        });

        // --- SINCRONIZAÇÃO DOS CAMPOS DO ESTÚDIO DE CORES ---
        function syncColorStudioInputs(hex) {
            if (suppressColorSync) return;
            suppressColorSync = true;
            const rgb = hexToRgb(hex);
            const hsl = hexToHsl(hex);

            const setVal = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = val; };
            setVal('cs-input-hex', hex.toUpperCase());
            setVal('cs-input-r', Math.round(rgb.r));
            setVal('cs-input-g', Math.round(rgb.g));
            setVal('cs-input-b', Math.round(rgb.b));
            setVal('cs-input-h', Math.round(hsl.h));
            setVal('cs-input-s', Math.round(hsl.s));
            setVal('cs-input-l', Math.round(hsl.l));

            if (ironPicker) ironPicker.color.hexString = hex;

            renderHarmonies();
            renderTonalRamp();
            suppressColorSync = false;
        }

        function initColorStudio() {
            if (!ironPicker && typeof iro !== 'undefined') {
                ironPicker = new iro.ColorPicker('#iro-picker-container', {
                    width: 190,
                    color: State.currentColor,
                    layout: [
                        { component: iro.ui.Wheel, options: {} },
                        { component: iro.ui.Slider, options: { sliderType: 'value' } },
                        { component: iro.ui.Slider, options: { sliderType: 'alpha' } }
                    ]
                });
                ironPicker.on('color:change', (color) => {
                    if (suppressColorSync) return;
                    setCurrentColor(color.hexString, { skipSync: true });
                    syncColorStudioInputsExceptWheel(color.hexString);
                });
            }
            syncColorStudioInputs(State.currentColor);
            renderFavoriteColors();
            renderSavedPalettes();
        }
        // Igual a syncColorStudioInputs, mas sem re-tocar a própria roda (evita jitter ao arrastar).
        function syncColorStudioInputsExceptWheel(hex) {
            suppressColorSync = true;
            const rgb = hexToRgb(hex);
            const hsl = hexToHsl(hex);
            const setVal = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = val; };
            setVal('cs-input-hex', hex.toUpperCase());
            setVal('cs-input-r', Math.round(rgb.r));
            setVal('cs-input-g', Math.round(rgb.g));
            setVal('cs-input-b', Math.round(rgb.b));
            setVal('cs-input-h', Math.round(hsl.h));
            setVal('cs-input-s', Math.round(hsl.s));
            setVal('cs-input-l', Math.round(hsl.l));
            renderHarmonies();
            renderTonalRamp();
            suppressColorSync = false;
        }

        document.getElementById('btn-open-color-studio')?.addEventListener('click', () => {
            openModal('modal-color-studio');
            initColorStudio();
        });
        document.getElementById('modal-color-studio-close')?.addEventListener('click', closeAllModals);
        document.getElementById('modal-color-studio')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-color-studio') closeAllModals();
        });

        // Campos numéricos (hex/rgb/hsl) → atualizam a cor atual ao editar.
        document.getElementById('cs-input-hex')?.addEventListener('change', (e) => {
            const v = e.target.value.trim();
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) setCurrentColor(v.startsWith('#') ? v : `#${v}`);
        });
        ['cs-input-r', 'cs-input-g', 'cs-input-b'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                const r = parseInt(document.getElementById('cs-input-r').value) || 0;
                const g = parseInt(document.getElementById('cs-input-g').value) || 0;
                const b = parseInt(document.getElementById('cs-input-b').value) || 0;
                setCurrentColor(rgbToHex(r, g, b));
            });
        });
        ['cs-input-h', 'cs-input-s', 'cs-input-l'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                const h = parseInt(document.getElementById('cs-input-h').value) || 0;
                const s = parseInt(document.getElementById('cs-input-s').value) || 0;
                const l = parseInt(document.getElementById('cs-input-l').value) || 0;
                setCurrentColor(hslToHex(h, s, l));
            });
        });
        document.getElementById('cs-input-alpha')?.addEventListener('change', () => {
            // Alpha é aplicado apenas via ferramentas que suportam transparência (o valor fica
            // guardado para uso futuro do pincel); a cor sólida em si não muda de canal alpha.
        });

        function drawOverlayGrid() {
            ctxOverlay.clearRect(0, 0, 64, 64);
            if (!State.gridVisible) return;

            ctxOverlay.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctxOverlay.lineWidth = 0.5;

            for (let i = 0; i <= 64; i += 4) {
                ctxOverlay.beginPath();
                ctxOverlay.moveTo(i, 0);
                ctxOverlay.lineTo(i, 64);
                ctxOverlay.stroke();

                ctxOverlay.beginPath();
                ctxOverlay.moveTo(0, i);
                ctxOverlay.lineTo(64, i);
                ctxOverlay.stroke();
            }
        }

        const STAMPS = {
            creeper: { width: 8, height: 8, data: [1,1,1,1,1,1,1,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,1,1,0,0,1,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1] },
            heart: { width: 7, height: 7, data: [0,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,0,0,0,1,1,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0] },
            star: { width: 7, height: 7, data: [0,0,0,1,0,0,0,0,0,1,1,1,0,0,1,1,1,1,1,1,1,0,1,1,1,1,1,0,0,1,0,1,0,1,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0] },
            sword: { width: 7, height: 7, data: [0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,1,1,1,0,0,0,1,0,1,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0] }
        };

        function floodFill(startX, startY, fillColorHex) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;

            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const data = imgData.data;

            const c = new THREE.Color(fillColorHex);
            const targetR = Math.round(c.r * 255);
            const targetG = Math.round(c.g * 255);
            const targetB = Math.round(c.b * 255);
            const targetA = 255;

            const startIdx = (startY * 64 + startX) * 4;
            const startR = data[startIdx];
            const startG = data[startIdx + 1];
            const startB = data[startIdx + 2];
            const startA = data[startIdx + 3];

            if (startR === targetR && startG === targetG && startB === targetB && startA === targetA) return;

            const queue = [[startX, startY]];
            const visited = new Uint8Array(64 * 64);

            while (queue.length > 0) {
                const [x, y] = queue.pop();
                if (x < 0 || x >= 64 || y < 0 || y >= 64) continue;
                if (!isPixelInScope(x, y)) continue;
                
                const pos = y * 64 + x;
                if (visited[pos]) continue;
                visited[pos] = 1;

                const idx = pos * 4;
                if (data[idx] === startR && data[idx + 1] === startG && data[idx + 2] === startB && data[idx + 3] === startA) {
                    data[idx] = targetR;
                    data[idx + 1] = targetG;
                    data[idx + 2] = targetB;
                    data[idx + 3] = targetA;

                    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
                }
            }

            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
        }

        function shadeSinglePixel(ctx, px, py, factor) {
            const imgData = ctx.getImageData(px, py, 1, 1);
            const d = imgData.data;
            if (d[3] === 0) return;
            d[0] = Math.max(0, Math.min(255, d[0] + d[0] * factor));
            d[1] = Math.max(0, Math.min(255, d[1] + d[1] * factor));
            d[2] = Math.max(0, Math.min(255, d[2] + d[2] * factor));
            ctx.putImageData(imgData, px, py);
        }

        function shadePixel(x, y, factor = -0.15) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;

            const ctx = activeLayer.ctx;
            const size = State.brushSize;

            for (let dy = 0; dy < size; dy++) {
                for (let dx = 0; dx < size; dx++) {
                    const px = x + dx;
                    const py = y + dy;
                    if (px < 0 || px >= 64 || py < 0 || py >= 64) continue;
                    paintPixelWithSymmetry(ctx, px, py, (c, sx, sy) => shadeSinglePixel(c, sx, sy, factor));
                }
            }
            render2DCanvas();
        }

        function getBresenhamLine(x0, y0, x1, y1) {
            const points = [];
            const dx = Math.abs(x1 - x0);
            const dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1;
            const sy = y0 < y1 ? 1 : -1;
            let err = dx - dy;

            let currX = x0;
            let currY = y0;

            while (true) {
                points.push({ x: currX, y: currY });
                if (currX === x1 && currY === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) {
                    err -= dy;
                    currX += sx;
                }
                if (e2 < dx) {
                    err += dx;
                    currY += sy;
                }
            }
            return points;
        }

        function getRectPoints(x0, y0, x1, y1, filled) {
            const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
            const points = [];
            if (filled) {
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) points.push({ x, y });
                }
            } else {
                for (let x = minX; x <= maxX; x++) { points.push({ x, y: minY }); points.push({ x, y: maxY }); }
                for (let y = minY; y <= maxY; y++) { points.push({ x: minX, y }); points.push({ x: maxX, y }); }
            }
            return points;
        }

        // Círculo pixel-perfect (algoritmo do ponto médio), centrado em (cx,cy).
        function getCirclePoints(cx, cy, ex, ey, filled) {
            const r = Math.round(Math.max(Math.abs(ex - cx), Math.abs(ey - cy)));
            const points = [];
            if (r <= 0) { points.push({ x: cx, y: cy }); return points; }

            let x = r, y = 0, err = 0;
            while (x >= y) {
                if (filled) {
                    for (let fx = cx - x; fx <= cx + x; fx++) { points.push({ x: fx, y: cy + y }); points.push({ x: fx, y: cy - y }); }
                    for (let fx = cx - y; fx <= cx + y; fx++) { points.push({ x: fx, y: cy + x }); points.push({ x: fx, y: cy - x }); }
                } else {
                    points.push({ x: cx + x, y: cy + y }, { x: cx + y, y: cy + x }, { x: cx - y, y: cy + x }, { x: cx - x, y: cy + y },
                                 { x: cx - x, y: cy - y }, { x: cx - y, y: cy - x }, { x: cx + y, y: cy - x }, { x: cx + x, y: cy - y });
                }
                y++;
                if (err <= 0) err += 2 * y + 1;
                if (err > 0) { x--; err -= 2 * x + 1; }
            }
            return points;
        }

        // Retorna os pontos a pintar para a ferramenta de forma ativa (linha/retângulo/círculo).
        function getShapePoints(tool, x0, y0, x1, y1) {
            if (tool === 'line') return getBresenhamLine(x0, y0, x1, y1);
            if (tool === 'rect') return getRectPoints(x0, y0, x1, y1, State.shapeFilled);
            if (tool === 'circle') return getCirclePoints(x0, y0, x1, y1, State.shapeFilled);
            return [];
        }

        function applyStampAt(x, y) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;

            const stampKey = State.selectedStamp || 'creeper';
            const stamp = STAMPS[stampKey];
            if (!stamp) return;

            const ctx = activeLayer.ctx;
            ctx.fillStyle = State.currentColor;

            for (let sy = 0; sy < stamp.height; sy++) {
                for (let sx = 0; sx < stamp.width; sx++) {
                    if (stamp.data[sy * stamp.width + sx] === 1) {
                        const px = x + sx;
                        const py = y + sy;
                        if (px >= 0 && px < 64 && py >= 0 && py < 64) {
                            paintPixelWithSymmetry(ctx, px, py, (c, tx, ty) => c.fillRect(tx, ty, 1, 1));
                        }
                    }
                }
            }
            render2DCanvas();
        }

        // Ferramenta Degradê: preenche, entre os dois pontos arrastados, uma transição
        // linear da cor primária (início) para a secundária (fim). Só recolore pixels que
        // já têm conteúdo (não-transparentes) na camada ativa, respeitando a região isolada.
        function applyGradientTool(x0, y0, x1, y1) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;

            const ctx = activeLayer.ctx;
            const imgData = ctx.getImageData(0, 0, 64, 64);
            const d = imgData.data;

            const c1 = hexToRgb(State.currentColor);
            const c2 = hexToRgb(State.secondaryColor);
            const dx = x1 - x0, dy = y1 - y0;
            const lenSq = dx * dx + dy * dy || 1;

            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const idx = (y * 64 + x) * 4;
                    if (d[idx + 3] === 0) continue;
                    if (!isPixelInScope(x, y)) continue;

                    let t = ((x - x0) * dx + (y - y0) * dy) / lenSq;
                    t = Math.max(0, Math.min(1, t));

                    d[idx]     = Math.round(c1.r + (c2.r - c1.r) * t);
                    d[idx + 1] = Math.round(c1.g + (c2.g - c1.g) * t);
                    d[idx + 2] = Math.round(c1.b + (c2.b - c1.b) * t);
                }
            }
            ctx.putImageData(imgData, 0, 0);
            render2DCanvas();
            saveHistoryState();
            showToast('Degradê aplicado', 'success');
        }

        function applyToolAtCoords(x, y) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || !activeLayer.visible || activeLayer.locked) return;

            const ctx = activeLayer.ctx;
            const size = State.brushSize;

            if (['picker', 'fill', 'pencil', 'eraser', 'shading', 'stamp'].includes(State.activeTool)) {
                // Se houver uma região isolada OU uma face selecionada, a pintura fica restrita a ela.
                if (!isPixelInScope(x, y)) {
                    // Quando desenha no 3D, a mesh invisível ainda é interceptada pelo raycaster.
                    // Isso ignora a pintura se a região/face estiver fora do escopo ativo.
                    return; 
                }
            }

            if (State.activeTool === 'pencil' || State.activeTool === 'eraser') {
                if (State.activeTool === 'pencil') {
                    ctx.fillStyle = State.currentColor;
                }
                const isPencil = State.activeTool === 'pencil';
                for (let dy = 0; dy < size; dy++) {
                    for (let dx = 0; dx < size; dx++) {
                        const px = x + dx;
                        const py = y + dy;
                        if (px < 0 || px >= 64 || py < 0 || py >= 64) continue;
                        paintPixelWithSymmetry(ctx, px, py, (c, tx, ty) => {
                            if (isPencil) c.fillRect(tx, ty, 1, 1);
                            else c.clearRect(tx, ty, 1, 1);
                        });
                    }
                }
                render2DCanvas();
            } else if (State.activeTool === 'picker') {
                const pixelData = ctx2D.getImageData(x, y, 1, 1).data;
                if (pixelData[3] === 0) return;
                const hex = "#" + ((1 << 24) + (pixelData[0] << 16) + (pixelData[1] << 8) + pixelData[2]).toString(16).slice(1);
                setCurrentColor(hex);
                showToast(`Cor capturada: ${hex}`, 'info');
            } else if (State.activeTool === 'fill') {
                floodFill(x, y, State.currentColor);
            } else if (State.activeTool === 'shading') {
                shadePixel(x, y, -0.15);
            } else if (State.activeTool === 'stamp') {
                applyStampAt(x, y);
            }
        }

        function init3D() {
            try {
                const container = document.getElementById('viewport-3d');
                if (!container) return;

                scene = new THREE.Scene();

                camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
                camera.position.set(0, 4, 32);

                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
                renderer.setSize(container.clientWidth, container.clientHeight);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                
                container.innerHTML = '';
                container.appendChild(renderer.domElement);

                if (typeof THREE.OrbitControls !== 'undefined') {
                    controls = new THREE.OrbitControls(camera, renderer.domElement);
                } else if (typeof OrbitControls !== 'undefined') {
                    controls = new OrbitControls(camera, renderer.domElement);
                } else {
                    controls = { update: () => {}, target: new THREE.Vector3(0, 4, 0), enabled: true };
                }

                if(controls.enableDamping !== undefined) {
                    controls.enableDamping = true;
                    controls.dampingFactor = 0.05;
                }
                if (controls.target) controls.target.set(0, 4, 0);

                const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
                scene.add(ambientLight);

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
                dirLight.position.set(20, 40, 20);
                dirLight.shadow.mapSize.set(1024, 1024);
                dirLight.shadow.camera.near = 1;
                dirLight.shadow.camera.far = 100;
                dirLight.shadow.camera.left = -30;
                dirLight.shadow.camera.right = 30;
                dirLight.shadow.camera.top = 30;
                dirLight.shadow.camera.bottom = -30;
                scene.add(dirLight);

                // Chão que recebe sombra — só fica visível quando "Sombras" é ativado.
                const groundPlane = new THREE.Mesh(
                    new THREE.PlaneGeometry(200, 200),
                    new THREE.ShadowMaterial({ opacity: 0.35 })
                );
                groundPlane.rotation.x = -Math.PI / 2;
                groundPlane.position.y = -17;
                groundPlane.receiveShadow = true;
                groundPlane.visible = false;
                scene.add(groundPlane);

                threeTexture = new THREE.CanvasTexture(canvas2D);
                threeTexture.magFilter = THREE.NearestFilter;
                threeTexture.minFilter = THREE.NearestFilter;
                threeTexture.needsUpdate = true; // Força atualização imediata

                material = new THREE.MeshStandardMaterial({
                    map: threeTexture,
                    transparent: true,
                    alphaTest: 0.1
                });

                overlayMaterial = new THREE.MeshStandardMaterial({
                    map: threeTexture,
                    transparent: true,
                    alphaTest: 0.1
                });

                buildPlayerModel();

                const raycaster = new THREE.Raycaster();
                const mouseVec = new THREE.Vector2();

                function get3DUVCoordinates(e) {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouseVec, camera);
                    // Em vez de cruzar todos os filhos, cruza apenas os visíveis.
                    const visibleMeshes = playerGroup.children.filter(child => child.visible);
                    const intersects = raycaster.intersectObjects(visibleMeshes, true);
                    
                    if (intersects.length > 0 && intersects[0].uv) {
                        const uv = intersects[0].uv;
                        const x = Math.floor(uv.x * 64);
                        const y = Math.floor((1.0 - uv.y) * 64);
                        return { x: Math.max(0, Math.min(63, x)), y: Math.max(0, Math.min(63, y)) };
                    }
                    return null;
                }

                let is3DPaintingActive = false;

                renderer.domElement.addEventListener('pointerdown', (e) => {
                    if (State.faceSelectMode && e.button === 0) {
                        const coords = get3DUVCoordinates(e);
                        if (coords) {
                            const face = findFaceAtPixel(coords.x, coords.y);
                            if (face) {
                                activeFaceSelection = face;
                                showFaceSelectionBanner(face);
                                render2DCanvas();
                                showToast(`Face selecionada: ${face.label}`, 'success');
                            } else {
                                showToast('Nenhuma face reconhecida nesse ponto', 'warning');
                            }
                        }
                        return;
                    }

                    if (!State.is3DPainting) return;
                    const coords = get3DUVCoordinates(e);
                    if (coords && e.button === 0) {
                        if (controls) controls.enabled = false;
                        is3DPaintingActive = true;
                        applyToolAtCoords(coords.x, coords.y);
                    }
                });

                renderer.domElement.addEventListener('pointermove', (e) => {
                    if (is3DPaintingActive) {
                        const coords = get3DUVCoordinates(e);
                        if (coords) {
                            applyToolAtCoords(coords.x, coords.y);
                        }
                    }
                });

                window.addEventListener('pointerup', () => {
                    if (is3DPaintingActive) {
                        is3DPaintingActive = false;
                        if (controls) controls.enabled = true;
                        saveHistoryState();
                    }
                });

                // Mesma proteção do blur global, mas para o estado de pintura direta no 3D
                // (fica numa closure própria, então precisa do próprio reset aqui).
                window.addEventListener('blur', () => {
                    if (is3DPaintingActive) {
                        is3DPaintingActive = false;
                        if (controls) controls.enabled = true;
                    }
                });

                document.getElementById('cam-front')?.addEventListener('click', () => { camera.position.set(0, 4, 32); if (controls.target) controls.target.set(0, 4, 0); });
                document.getElementById('cam-back')?.addEventListener('click', () => { camera.position.set(0, 4, -32); if (controls.target) controls.target.set(0, 4, 0); });
                document.getElementById('cam-left')?.addEventListener('click', () => { camera.position.set(-32, 4, 0); if (controls.target) controls.target.set(0, 4, 0); });
                document.getElementById('cam-right')?.addEventListener('click', () => { camera.position.set(32, 4, 0); if (controls.target) controls.target.set(0, 4, 0); });
                document.getElementById('cam-top')?.addEventListener('click', () => { camera.position.set(0, 36, 0.1); if (controls.target) controls.target.set(0, 4, 0); });
                document.getElementById('cam-bottom')?.addEventListener('click', () => { camera.position.set(0, -28, 0.1); if (controls.target) controls.target.set(0, 4, 0); });

                document.getElementById('cam-move-left')?.addEventListener('click', () => { if (controls.target) controls.target.x -= 2; camera.position.x -= 2; });
                document.getElementById('cam-move-right')?.addEventListener('click', () => { if (controls.target) controls.target.x += 2; camera.position.x += 2; });
                document.getElementById('cam-move-up')?.addEventListener('click', () => { if (controls.target) controls.target.y += 2; camera.position.y += 2; });
                document.getElementById('cam-move-down')?.addEventListener('click', () => { if (controls.target) controls.target.y -= 2; camera.position.y -= 2; });

                document.getElementById('cam-reset')?.addEventListener('click', () => {
                    camera.position.set(0, 4, 32);
                    if (controls.target) controls.target.set(0, 4, 0);
                    showToast('Câmera resetada', 'info');
                });

                // Foca a câmera aproximadamente na região atualmente isolada em "Visualizar".
                const FOCUS_POINTS = {
                    all:   { pos: [0, 4, 32],  target: [0, 4, 0] },
                    head:  { pos: [0, 15, 16], target: [0, 12, 0] },
                    body:  { pos: [0, 5, 14],  target: [0, 2, 0] },
                    base:  { pos: [0, 4, 32],  target: [0, 4, 0] },
                    overlay: { pos: [0, 4, 32], target: [0, 4, 0] },
                    limbs: { pos: [0, -4, 20], target: [0, -6, 0] }
                };
                document.getElementById('cam-focus-part')?.addEventListener('click', () => {
                    const focus = FOCUS_POINTS[activeIsolatedRegion] || FOCUS_POINTS.all;
                    camera.position.set(...focus.pos);
                    if (controls.target) controls.target.set(...focus.target);
                    showToast('Câmera focada na parte selecionada em "Visualizar"', 'info');
                });

                document.getElementById('btn-toggle-autorotate')?.addEventListener('click', () => {
                    controls.autoRotate = !controls.autoRotate;
                    controls.autoRotateSpeed = 2.5;
                    const icon = document.getElementById('icon-autorotate-check');
                    if (icon) icon.className = controls.autoRotate
                        ? 'fa-solid fa-toggle-on text-indigo-400 text-sm'
                        : 'fa-solid fa-toggle-off text-slate-500 text-sm';
                });

                // --- AMBIENTE: wireframe, sombras, fundo, intensidade das luzes ---
                document.getElementById('btn-toggle-wireframe')?.addEventListener('click', () => {
                    material.wireframe = !material.wireframe;
                    overlayMaterial.wireframe = material.wireframe;
                    const icon = document.getElementById('icon-wireframe-check');
                    if (icon) icon.className = material.wireframe
                        ? 'fa-solid fa-toggle-on text-indigo-400 text-sm'
                        : 'fa-solid fa-toggle-off text-slate-500 text-sm';
                });

                document.getElementById('btn-toggle-shadows')?.addEventListener('click', () => {
                    const enabled = !renderer.shadowMap.enabled;
                    renderer.shadowMap.enabled = enabled;
                    dirLight.castShadow = enabled;
                    playerGroup.traverse(o => { if (o.isMesh) { o.castShadow = enabled; o.receiveShadow = enabled; } });
                    if (groundPlane) groundPlane.visible = enabled;
                    const icon = document.getElementById('icon-shadows-check');
                    if (icon) icon.className = enabled
                        ? 'fa-solid fa-toggle-on text-indigo-400 text-sm'
                        : 'fa-solid fa-toggle-off text-slate-500 text-sm';
                });

                document.getElementById('input-3d-bg-color')?.addEventListener('input', (e) => {
                    scene.background = new THREE.Color(e.target.value);
                });
                document.getElementById('btn-toggle-bg-transparent')?.addEventListener('click', () => {
                    scene.background = null;
                    showToast('Fundo do 3D definido como transparente', 'info');
                });

                document.getElementById('slider-ambient-light')?.addEventListener('input', (e) => {
                    ambientLight.intensity = parseInt(e.target.value) / 100;
                    const label = document.getElementById('label-ambient-value');
                    if (label) label.textContent = `${e.target.value}%`;
                });
                document.getElementById('slider-directional-light')?.addEventListener('input', (e) => {
                    dirLight.intensity = parseInt(e.target.value) / 100;
                    const label = document.getElementById('label-directional-value');
                    if (label) label.textContent = `${e.target.value}%`;
                });

                // --- HIGHLIGHT DE PIXEL AO PASSAR O MOUSE NO 3D ---
                let lastHoveredRegion3D = null;
                renderer.domElement.addEventListener('pointermove', (e) => {
                    if (is3DPaintingActive) return; // durante a pintura, o próprio traço já dá o feedback
                    const coords = get3DUVCoordinates(e);
                    ctxOverlay.clearRect(0, 0, 64, 64);
                    drawOverlayGrid();
                    if (coords) {
                        ctxOverlay.strokeStyle = '#38bdf8';
                        ctxOverlay.lineWidth = 0.6;
                        ctxOverlay.strokeRect(coords.x + 0.1, coords.y + 0.1, 0.8, 0.8);
                        const coordsDisplay = document.getElementById('coords-display');
                        if (coordsDisplay) coordsDisplay.textContent = `X: ${coords.x}, Y: ${coords.y} (via 3D)`;

                        showUvTooltip(coords.x, coords.y, e.clientX, e.clientY);
                        const region = REGIONS_INFO.find(r => coords.x >= r.x && coords.x < r.x + r.w && coords.y >= r.y && coords.y < r.y + r.h);
                        if (region && region.key !== lastHoveredRegion3D) {
                            lastHoveredRegion3D = region.key;
                        }
                    } else {
                        hideUvTooltip();
                        lastHoveredRegion3D = null;
                    }
                });
                renderer.domElement.addEventListener('pointerleave', () => {
                    ctxOverlay.clearRect(0, 0, 64, 64);
                    drawOverlayGrid();
                    hideUvTooltip();
                    lastHoveredRegion3D = null;
                });

                const toggle3DBtn = document.getElementById('btn-toggle-3d-lock');
                toggle3DBtn?.addEventListener('click', () => {
                    State.is3DPainting = !State.is3DPainting;
                    const icon = document.getElementById('icon-3d-lock');
                    const text = document.getElementById('text-3d-lock');

                    if (State.is3DPainting) {
                        toggle3DBtn.className = "pointer-events-auto px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg backdrop-blur border border-emerald-500/50 flex items-center gap-2 transition";
                        if (icon) icon.className = "fa-solid fa-paintbrush";
                        if (text) text.textContent = "Pintando no 3D (Ativo)";
                        showToast('Modo de pintura 3D ativado!', 'success');
                    } else {
                        toggle3DBtn.className = "pointer-events-auto px-3.5 py-1.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow-lg backdrop-blur border border-amber-500/50 flex items-center gap-2 transition";
                        if (icon) icon.className = "fa-solid fa-rotate";
                        if (text) text.textContent = "Girar Câmera 3D";
                        showToast('Modo de rotação 3D ativado', 'info');
                    }
                });

                window.addEventListener('resize', () => {
                    if (container && renderer && camera) {
                        camera.aspect = container.clientWidth / container.clientHeight;
                        camera.updateProjectionMatrix();
                        renderer.setSize(container.clientWidth, container.clientHeight);
                    }
                });

                let fpsFrameCount = 0, fpsLastCheck = performance.now();
                function animate() {
                    requestAnimationFrame(animate);
                    if (controls && controls.update) controls.update();

                    if (State.currentAnimation !== 'none' && limbPivots.armR) {
                        const t = performance.now() / 1000;
                        const pose = computeAnimationPose(State.currentAnimation, t);
                        limbPivots.armR.rotation.x = pose.armR;
                        limbPivots.armL.rotation.x = pose.armL;
                        limbPivots.legR.rotation.x = pose.legR;
                        limbPivots.legL.rotation.x = pose.legL;
                        if (playerGroup) playerGroup.position.y = pose.bodyY;
                    }

                    if (renderer && scene && camera) renderer.render(scene, camera);

                    // Contador de FPS (Seção 24) — atualiza a cada ~500ms pra não pesar o DOM.
                    fpsFrameCount++;
                    const now = performance.now();
                    if (now - fpsLastCheck >= 500) {
                        const fps = Math.round((fpsFrameCount * 1000) / (now - fpsLastCheck));
                        const fpsLabel = document.getElementById('label-3d-fps');
                        if (fpsLabel) fpsLabel.textContent = `${fps} FPS`;
                        fpsFrameCount = 0;
                        fpsLastCheck = now;
                    }
                }
                animate();
            } catch (err) {
                console.error("Erro ao inicializar 3D:", err);
                showToast("Erro ao carregar o modelo 3D.", "warning");
            }
        }

        function getCanvasCoordinates(e) {
            const rect = canvas2D.getBoundingClientRect();
            const scaleX = 64 / rect.width;
            const scaleY = 64 / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX);
            const y = Math.floor((e.clientY - rect.top) * scaleY);
            return {
                x: Math.max(0, Math.min(63, x)),
                y: Math.max(0, Math.min(63, y))
            };
        }

        function update2DTransform() {
            const wrapper = document.getElementById('canvas-2d-wrapper');
            if (wrapper) {
                wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${State.zoom})`;
            }
        }

        const SHAPE_TOOLS = ['line', 'rect', 'circle'];
        let isDrawingShape = false;
        let isDrawingGradient = false;

        canvas2D.addEventListener('mousedown', (e) => {
            const coordsForPick = getCanvasCoordinates(e);
            if (isPickingReplaceSource) {
                const pixelData = ctx2D.getImageData(coordsForPick.x, coordsForPick.y, 1, 1).data;
                isPickingReplaceSource = false;
                if (pixelData[3] === 0) {
                    showToast('Pixel vazio — escolha um pixel com cor', 'warning');
                    return;
                }
                const hex = rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
                performColorReplace(hex);
                return;
            }

            if (State.activeTool === 'pan' || e.button === 1 || e.button === 2) {
                isPanning2D = true;
                startPanX = e.clientX - panX;
                startPanY = e.clientY - panY;
                e.preventDefault();
                return;
            }

            const coords = getCanvasCoordinates(e);

            if (SHAPE_TOOLS.includes(State.activeTool)) {
                isDrawingShape = true;
                State.lineStart = coords;
                return;
            }

            if (State.activeTool === 'gradient') {
                isDrawingGradient = true;
                State.lineStart = coords;
                return;
            }

            isPainting = true;
            applyToolAtCoords(coords.x, coords.y);
        });

        canvas2D.addEventListener('mousemove', (e) => {
            if (isPanning2D) {
                panX = e.clientX - startPanX;
                panY = e.clientY - startPanY;
                update2DTransform();
                return;
            }

            const coords = getCanvasCoordinates(e);
            const coordsDisplay = document.getElementById('coords-display');
            if (coordsDisplay) coordsDisplay.textContent = `X: ${coords.x}, Y: ${coords.y}`;

            if ((isDrawingShape || isDrawingGradient) && State.lineStart) {
                drawOverlayGrid();
                ctxOverlay.fillStyle = State.currentColor;
                if (isDrawingGradient) {
                    ctxOverlay.strokeStyle = State.currentColor;
                    ctxOverlay.lineWidth = 0.5;
                    ctxOverlay.beginPath();
                    ctxOverlay.moveTo(State.lineStart.x + 0.5, State.lineStart.y + 0.5);
                    ctxOverlay.lineTo(coords.x + 0.5, coords.y + 0.5);
                    ctxOverlay.stroke();
                } else {
                    const shapePoints = getShapePoints(State.activeTool, State.lineStart.x, State.lineStart.y, coords.x, coords.y);
                    shapePoints.forEach(p => {
                        ctxOverlay.fillRect(p.x, p.y, State.brushSize, State.brushSize);
                    });
                }
                return;
            }

            if (isPainting) {
                applyToolAtCoords(coords.x, coords.y);
                return;
            }

            // Hover "puro" (não pintando nem desenhando forma): tooltip do Editor UV,
            // realce do part correspondente no 3D, e prévia do tamanho do pincel.
            showUvTooltip(coords.x, coords.y, e.clientX, e.clientY);
            const hoveredRegion = REGIONS_INFO.find(r => coords.x >= r.x && coords.x < r.x + r.w && coords.y >= r.y && coords.y < r.y + r.h);
            if (hoveredRegion) highlightMeshByRegion(hoveredRegion.key); else clearMeshHighlight();

            drawOverlayGrid();
            if (['pencil', 'eraser', 'shading'].includes(State.activeTool)) {
                ctxOverlay.strokeStyle = State.activeTool === 'eraser' ? '#f87171' : '#38bdf8';
                ctxOverlay.lineWidth = 0.5;
                ctxOverlay.strokeRect(coords.x, coords.y, State.brushSize, State.brushSize);
            }
        });

        canvas2D.addEventListener('mouseleave', () => {
            hideUvTooltip();
            clearMeshHighlight();
            drawOverlayGrid();
        });

        window.addEventListener('mouseup', (e) => {
            if (isPanning2D) {
                isPanning2D = false;
            }
            if (isDrawingShape && State.lineStart) {
                isDrawingShape = false;
                const coords = getCanvasCoordinates(e);

                const shapePoints = getShapePoints(State.activeTool, State.lineStart.x, State.lineStart.y, coords.x, coords.y);
                const activeLayer = State.layers[State.activeLayerIndex];
                if (activeLayer && activeLayer.visible && !activeLayer.locked) {
                    activeLayer.ctx.fillStyle = State.currentColor;
                    shapePoints.forEach(p => {
                        for(let dy=0; dy<State.brushSize; dy++) {
                            for(let dx=0; dx<State.brushSize; dx++) {
                                const px = p.x + dx;
                                const py = p.y + dy;
                                if (px < 0 || px >= 64 || py < 0 || py >= 64) continue;
                                paintPixelWithSymmetry(activeLayer.ctx, px, py, (c, tx, ty) => c.fillRect(tx, ty, 1, 1));
                            }
                        }
                    });
                    render2DCanvas();
                    saveHistoryState();
                }
                State.lineStart = null;
                drawOverlayGrid();
            }
            if (isDrawingGradient && State.lineStart) {
                isDrawingGradient = false;
                const coords = getCanvasCoordinates(e);
                applyGradientTool(State.lineStart.x, State.lineStart.y, coords.x, coords.y);
                State.lineStart = null;
                drawOverlayGrid();
            }
            if (isPainting) {
                isPainting = false;
                saveHistoryState();
            }
        });

        // Se a janela perder o foco (ex.: Alt+Tab) no meio de um arraste, os estados abaixo
        // ficariam presos em "true" pra sempre (o mouseup nunca chega a disparar), fazendo a
        // ferramenta se comportar de forma esquisita ao voltar. Cancela tudo com segurança.
        window.addEventListener('blur', () => {
            isPanning2D = false;
            if (isDrawingShape || isDrawingGradient) {
                isDrawingShape = false;
                isDrawingGradient = false;
                State.lineStart = null;
                drawOverlayGrid();
            }
            isPainting = false;
            collageDrag = null;
        });

        document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
            State.zoom = Math.min(10, State.zoom + 0.25);
            update2DTransform();
        });
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
            State.zoom = Math.max(0.5, State.zoom - 0.25);
            update2DTransform();
        });
        document.getElementById('btn-reset-zoom')?.addEventListener('click', () => {
            State.zoom = 1;
            panX = 0;
            panY = 0;
            update2DTransform();
        });

        document.getElementById('btn-toggle-grid')?.addEventListener('click', () => {
            State.gridVisible = !State.gridVisible;
            drawOverlayGrid();
            
            const icon = document.getElementById('icon-grid-check');
            if(icon) {
                icon.className = State.gridVisible 
                    ? 'fa-solid fa-toggle-on text-indigo-400 text-sm' 
                    : 'fa-solid fa-toggle-off text-slate-500 text-sm';
            }
            
            showToast(`Grade ${State.gridVisible ? 'Visível' : 'Oculta'}`, 'info');
        });

        document.getElementById('btn-toggle-template')?.addEventListener('click', () => {
            State.templateVisible = !State.templateVisible;
            
            const legendEl = document.getElementById('template-legend');

            if (State.templateVisible) {
                canvasTemplate.classList.remove('opacity-0');
                legendEl?.classList.remove('hidden');
            } else {
                canvasTemplate.classList.add('opacity-0');
                legendEl?.classList.add('hidden');
            }
            
            const icon = document.getElementById('icon-template-check');
            if(icon) {
                icon.className = State.templateVisible 
                    ? 'fa-solid fa-toggle-on text-indigo-400 text-sm' 
                    : 'fa-solid fa-toggle-off text-slate-500 text-sm';
            }
            
            showToast(`Guia UV (Template) ${State.templateVisible ? 'Ativada' : 'Desativada'}`, 'info');
        });

        // Setinhas de deslocamento (Pan) do editor 2D — espelha o Pan da câmera 3D.
        const PAN_2D_STEP = 25;
        document.getElementById('pan2d-up')?.addEventListener('click', () => { panY -= PAN_2D_STEP; update2DTransform(); });
        document.getElementById('pan2d-down')?.addEventListener('click', () => { panY += PAN_2D_STEP; update2DTransform(); });
        document.getElementById('pan2d-left')?.addEventListener('click', () => { panX -= PAN_2D_STEP; update2DTransform(); });
        document.getElementById('pan2d-right')?.addEventListener('click', () => { panX += PAN_2D_STEP; update2DTransform(); });

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                State.activeTool = btn.dataset.tool;

                const stampBar = document.getElementById('bar-stamp-options');
                if (stampBar) {
                    if (State.activeTool === 'stamp') stampBar.classList.remove('hidden');
                    else stampBar.classList.add('hidden');
                }

                const fillToggle = document.getElementById('shape-fill-toggle');
                if (fillToggle) {
                    fillToggle.classList.toggle('hidden', !['rect', 'circle'].includes(State.activeTool));
                }

                const collageBar = document.getElementById('bar-collage-options');
                if (collageBar) collageBar.classList.toggle('hidden', State.activeTool !== 'collage');
                if (canvasCollage) canvasCollage.style.pointerEvents = State.activeTool === 'collage' ? 'auto' : 'none';
                if (State.activeTool === 'collage') { syncCollageBar(); renderCollageCanvas(); }

                showToast(`Ferramenta: ${btn.title || State.activeTool}`, 'info');
            });
        });

        document.getElementById('btn-toggle-shape-fill')?.addEventListener('click', () => {
            State.shapeFilled = !State.shapeFilled;
            const icon = document.getElementById('icon-shape-fill-check');
            if (icon) icon.className = State.shapeFilled
                ? 'fa-solid fa-toggle-on text-indigo-400 text-sm'
                : 'fa-solid fa-toggle-off text-slate-500 text-sm';
        });

        const brushSizeSlider = document.getElementById('brush-size-slider');
        const brushSizeValue = document.getElementById('brush-size-value');
        const brushSizePreview = document.getElementById('brush-size-preview');

        function updateBrushSize(size) {
            size = Math.max(1, Math.min(8, size));
            State.brushSize = size;
            if (brushSizeSlider) brushSizeSlider.value = size;
            if (brushSizeValue) brushSizeValue.textContent = `${size}px`;
            if (brushSizePreview) {
                const px = Math.min(28, 4 + size * 3);
                brushSizePreview.style.width = `${px}px`;
                brushSizePreview.style.height = `${px}px`;
            }
        }

        brushSizeSlider?.addEventListener('input', (e) => {
            updateBrushSize(parseInt(e.target.value) || 1);
        });
        brushSizeSlider?.addEventListener('change', () => {
            showToast(`Pincel: ${State.brushSize}px`, 'info');
        });

        const btnImportSkin = document.getElementById('btn-import-skin');
        const inputSkinFile = document.getElementById('input-skin-file');

        btnImportSkin?.addEventListener('click', () => inputSkinFile.click());

        // Importa uma imagem para a camada ativa. Detecta o formato legado 64×32 e
        // converte automaticamente para 64×64, espelhando braço/perna direitos para o
        // lado esquerdo (que não existe no formato antigo) via UV_MIRROR_MAP.
        function importImageToActiveLayer(img) {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer || activeLayer.locked) {
                showToast('Camada ativa bloqueada!', 'warning');
                return;
            }

            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;

            activeLayer.ctx.clearRect(0, 0, 64, 64);

            if (w === 64 && h === 32) {
                // Formato legado: desenha a metade superior e auto-gera o lado esquerdo.
                activeLayer.ctx.drawImage(img, 0, 0, 64, 32, 0, 0, 64, 32);
                const full = activeLayer.ctx.getImageData(0, 0, 64, 64);
                const src = new Uint8ClampedArray(full.data);
                UV_MIRROR_MAP.forEach((dst, srcKey) => {
                    const [sx, sy] = srcKey.split(',').map(Number);
                    if (sy >= 32) return; // só espelha a partir da metade já desenhada
                    const srcIdx = (sy * 64 + sx) * 4;
                    const dstIdx = (dst.y * 64 + dst.x) * 4;
                    full.data[dstIdx] = src[srcIdx]; full.data[dstIdx+1] = src[srcIdx+1];
                    full.data[dstIdx+2] = src[srcIdx+2]; full.data[dstIdx+3] = src[srcIdx+3];
                });
                activeLayer.ctx.putImageData(full, 0, 0);
                showToast(`PNG 64×32 (legado) convertido e carregado na ${activeLayer.name}`, 'success');
            } else if (w === 64 && h === 64) {
                activeLayer.ctx.drawImage(img, 0, 0);
                showToast(`PNG carregado na ${activeLayer.name}`, 'success');
            } else {
                activeLayer.ctx.drawImage(img, 0, 0, 64, 64);
                showToast(`Imagem ${w}×${h} redimensionada para 64×64 (formato não-padrão)`, 'warning');
            }
            render2DCanvas();
            saveHistoryState();
            detectAndSuggestModelType();
        }

        // Heurística oficial da Mojang: o pixel (54,20) só existe (opaco) no modelo Classic
        // (braço de 4px); no Slim (3px) essa coluna fica transparente por convenção.
        function detectAndSuggestModelType() {
            const pixel = ctx2D.getImageData(54, 20, 1, 1).data;
            const detected = pixel[3] === 0 ? 'slim' : 'classic';
            if (detected !== State.modelType) {
                setModelType(detected, true);
                showToast(`Modelo detectado automaticamente: ${detected === 'classic' ? 'Classic (Steve)' : 'Slim (Alex)'}`, 'info');
            }
        }

        // Alguns navegadores/fluxos de arrastar-e-soltar não preenchem file.type
        // corretamente — nesse caso, cai para checar a extensão do nome do arquivo.
        function isImportableImageFile(file) {
            if (!file) return false;
            if (file.type && file.type.startsWith('image/')) return true;
            return /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
        }

        function importFileAsImage(file) {
            if (!isImportableImageFile(file)) {
                if (file) showToast(`"${file.name || 'arquivo'}" não é uma imagem reconhecida (use PNG, JPG, WEBP ou GIF)`, 'warning');
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => showToast('Não foi possível ler o arquivo selecionado', 'warning');
            reader.onload = (event) => {
                const img = new Image();
                img.onerror = () => showToast('Não foi possível carregar essa imagem — o arquivo pode estar corrompido', 'warning');
                img.onload = () => importImageToActiveLayer(img);
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }

        inputSkinFile?.addEventListener('change', (e) => {
            importFileAsImage(e.target.files[0]);
            inputSkinFile.value = '';
        });

        // Arrastar-e-soltar um PNG sobre a área do editor 2D.
        const canvas2DContainer = document.getElementById('canvas-2d-container');
        canvas2DContainer?.addEventListener('dragover', (e) => { e.preventDefault(); canvas2DContainer.classList.add('ring-2', 'ring-indigo-500'); });
        canvas2DContainer?.addEventListener('dragleave', () => canvas2DContainer.classList.remove('ring-2', 'ring-indigo-500'));
        canvas2DContainer?.addEventListener('drop', (e) => {
            e.preventDefault();
            canvas2DContainer.classList.remove('ring-2', 'ring-indigo-500');
            importFileAsImage(e.dataTransfer.files[0]);
        });

        // Colar (Ctrl+V) uma imagem da área de transferência.
        document.addEventListener('paste', (e) => {
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            const items = e.clipboardData?.items || [];
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    importFileAsImage(item.getAsFile());
                    e.preventDefault();
                    break;
                }
            }
        });

        // --- EXPORTAÇÃO ---
        // (o clique do botão "Exportar" já é tratado lá em cima, junto dos outros
        // botões de popover — aqui só ficam as ações de cada opção do menu.)

        function exportPngFlattened(filename, cropHeight = 64) {
            const tmp = document.createElement('canvas');
            tmp.width = 64; tmp.height = cropHeight;
            const tctx = tmp.getContext('2d');
            tctx.imageSmoothingEnabled = false;
            tctx.drawImage(canvas2D, 0, 0, 64, cropHeight, 0, 0, 64, cropHeight);
            const link = document.createElement('a');
            link.download = filename;
            link.href = tmp.toDataURL('image/png');
            link.click();
        }

        document.getElementById('btn-export-png-64')?.addEventListener('click', () => {
            exportPngFlattened('minecraft-skin.png', 64);
            markChangesSaved();
            showToast('Skin 64×64 exportada!', 'success');
            togglePopover('popover-export');
        });

        document.getElementById('btn-export-png-legacy')?.addEventListener('click', () => {
            exportPngFlattened('minecraft-skin-legacy.png', 32);
            markChangesSaved();
            showToast('Skin 64×32 (legado) exportada — braço/perna esquerdos não são incluídos', 'info');
            togglePopover('popover-export');
        });

        document.getElementById('btn-export-3d-screenshot')?.addEventListener('click', () => {
            try {
                const link = document.createElement('a');
                link.download = 'skin-screenshot-3d.png';
                link.href = renderer.domElement.toDataURL('image/png');
                link.click();
                markChangesSaved();
                showToast('Screenshot 3D exportado!', 'success');
            } catch (err) {
                showToast('Não foi possível capturar o 3D (contexto WebGL indisponível)', 'warning');
            }
            togglePopover('popover-export');
        });

        document.getElementById('btn-export-project-zip')?.addEventListener('click', async () => {
            if (typeof JSZip === 'undefined') { showToast('JSZip não carregou — verifique a conexão', 'warning'); return; }
            showToast('Gerando .zip do projeto…', 'info');

            const zip = new JSZip();
            const projectJson = {
                name: State.currentProjectName,
                modelType: State.modelType,
                exportedAt: new Date().toISOString(),
                layers: State.layers.map(l => ({ name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity }))
            };
            zip.file('project.json', JSON.stringify(projectJson, null, 2));

            const flattenedTmp = document.createElement('canvas');
            flattenedTmp.width = 64; flattenedTmp.height = 64;
            flattenedTmp.getContext('2d').drawImage(canvas2D, 0, 0);
            zip.file('skin.png', flattenedTmp.toDataURL('image/png').split(',')[1], { base64: true });

            const layersFolder = zip.folder('layers');
            State.layers.forEach((l, i) => {
                const safeName = l.name.replace(/[^a-z0-9_\-]/gi, '_');
                layersFolder.file(`${i + 1}_${safeName}.png`, l.canvas.toDataURL('image/png').split(',')[1], { base64: true });
            });

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `${State.currentProjectName.replace(/[^a-z0-9_\-]/gi, '_')}.zip`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            markChangesSaved();
            showToast('Projeto completo exportado (.zip)!', 'success');
            togglePopover('popover-export');
        });

        document.getElementById('btn-clear-storage')?.addEventListener('click', () => {
            showConfirmModal(
                'Resetar projeto',
                'Deseja limpar as texturas da skin e voltar às cores base? Todas as camadas atuais serão substituídas.',
                () => {
                    if (dbInstance) {
                        try {
                            const tx = dbInstance.transaction('project_store', 'readwrite');
                            tx.objectStore('project_store').delete('saved_skin_project');
                        } catch(e) {}
                    }
                    initLayers();
                    showToast('Projeto resetado!', 'info');
                },
                { confirmLabel: 'Resetar' }
            );
        });

        function initStampsUI() {
            const grid = document.getElementById('stamps-grid');
            if (!grid) return;
            grid.innerHTML = '';

            Object.keys(STAMPS).forEach(key => {
                const btn = document.createElement('button');
                btn.className = `p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 flex flex-col items-center justify-center gap-1 transition ${State.selectedStamp === key ? 'border-amber-400 bg-amber-500/10' : ''}`;
                btn.innerHTML = `<span class="text-xs font-bold capitalize text-amber-300">${key}</span>`;
                btn.addEventListener('click', () => {
                    State.selectedStamp = key;
                    State.activeTool = 'stamp';
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-tool-stamp')?.classList.add('active');
                    initStampsUI();
                    showToast(`Carimbo: ${key}`, 'info');
                });
                grid.appendChild(btn);
            });
        }

        const inputCustomStamp = document.getElementById('input-custom-stamp');
        inputCustomStamp?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const stampCanvas = document.createElement('canvas');
                    stampCanvas.width = 8;
                    stampCanvas.height = 8;
                    const sCtx = stampCanvas.getContext('2d');
                    sCtx.drawImage(img, 0, 0, 8, 8);
                    const imgData = sCtx.getImageData(0, 0, 8, 8).data;

                    const dataArr = [];
                    for (let i = 0; i < 64; i++) {
                        dataArr.push(imgData[i * 4 + 3] > 50 ? 1 : 0);
                    }

                    const customKey = 'custom_' + Date.now();
                    STAMPS[customKey] = { width: 8, height: 8, data: dataArr };
                    State.selectedStamp = customKey;
                    State.activeTool = 'stamp';
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-tool-stamp')?.classList.add('active');
                    initStampsUI();
                    showToast('Novo carimbo importado!', 'success');
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            inputCustomStamp.value = '';
        });

        document.getElementById('btn-shade-darken')?.addEventListener('click', () => {
            const c = new THREE.Color(State.currentColor);
            c.multiplyScalar(0.85);
            setCurrentColor('#' + c.getHexString());
        });

        document.getElementById('btn-shade-lighten')?.addEventListener('click', () => {
            const c = new THREE.Color(State.currentColor);
            c.lerp(new THREE.Color(0xffffff), 0.15);
            setCurrentColor('#' + c.getHexString());
        });

        // --- ABAS DA BARRA LATERAL DIREITA (Camadas / Carimbos) ---
        document.querySelectorAll('.tab-btn').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.classList.add('text-slate-500');
                });
                tabBtn.classList.add('active');
                tabBtn.classList.remove('text-slate-500');

                const target = tabBtn.dataset.tab;
                document.querySelectorAll('.tab-panel').forEach(panel => {
                    panel.classList.toggle('hidden', panel.id !== `tab-panel-${target}`);
                });
            });
        });

        // --- TELA CHEIA (painéis 3D e 2D) ---
        const FULLSCREEN_PANELS = [
            { panelId: 'panel-viewer-3d', btnId: 'btn-fullscreen-3d' },
            { panelId: 'panel-viewer-2d', btnId: 'btn-fullscreen-2d' }
        ];

        function toggleFullscreen(elementId) {
            const el = document.getElementById(elementId);
            if (!el) return;

            if (document.fullscreenElement === el) {
                document.exitFullscreen?.();
            } else if (!document.fullscreenElement) {
                el.requestFullscreen?.().catch(() => showToast('Tela cheia não suportada neste navegador', 'warning'));
            }
        }

        // Listener único e global: cobre tanto o clique no botão quanto o Esc nativo do navegador.
        document.addEventListener('fullscreenchange', () => {
            FULLSCREEN_PANELS.forEach(({ panelId, btnId }) => {
                const el = document.getElementById(panelId);
                const btn = document.getElementById(btnId);
                if (!el) return;
                const isFs = document.fullscreenElement === el;
                if (btn) btn.innerHTML = `<i class="fa-solid fa-${isFs ? 'compress' : 'expand'}"></i>`;
                el.classList.toggle('fixed', isFs);
                el.classList.toggle('inset-0', isFs);
                el.classList.toggle('z-50', isFs);
            });
            // Garante que o renderer 3D e o canvas se realinhem ao novo tamanho.
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        });

        document.getElementById('btn-fullscreen-3d')?.addEventListener('click', () => toggleFullscreen('panel-viewer-3d'));
        document.getElementById('btn-fullscreen-2d')?.addEventListener('click', () => toggleFullscreen('panel-viewer-2d'));

        // --- ATALHOS DE TECLADO (customizáveis, persistidos no navegador) ---
        const DEFAULT_SHORTCUTS = {
            pencil: 'p', eraser: 'e', pan: 'h', picker: 'i', fill: 'g', shading: 'b',
            line: 'l', rect: 'r', circle: 'c', gradient: 'd', stamp: 's',
            brush_dec: '[', brush_inc: ']'
        };
        const SHORTCUT_LABELS = {
            pencil: 'Lápis', eraser: 'Borracha', pan: 'Mover (Pan)', picker: 'Conta-gotas',
            fill: 'Balde', shading: 'Sombra', line: 'Linha', rect: 'Retângulo', circle: 'Círculo',
            gradient: 'Degradê', stamp: 'Carimbo', brush_dec: 'Pincel -', brush_inc: 'Pincel +'
        };
        const TOOL_ACTIONS = new Set(['pencil', 'eraser', 'pan', 'picker', 'fill', 'shading', 'line', 'rect', 'circle', 'gradient', 'stamp']);

        let SHORTCUTS = { ...DEFAULT_SHORTCUTS };
        function loadShortcuts() {
            try {
                const raw = localStorage.getItem('skin_editor_shortcuts');
                SHORTCUTS = raw ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) } : { ...DEFAULT_SHORTCUTS };
            } catch (e) { SHORTCUTS = { ...DEFAULT_SHORTCUTS }; }
        }
        function saveShortcutsToStorage() {
            try { localStorage.setItem('skin_editor_shortcuts', JSON.stringify(SHORTCUTS)); } catch (e) {}
        }

        let listeningForAction = null;
        function renderShortcutsList() {
            const listEl = document.getElementById('shortcuts-list');
            if (!listEl) return;
            listEl.innerHTML = '';

            Object.keys(SHORTCUT_LABELS).forEach(action => {
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                const key = SHORTCUTS[action] || '?';
                row.innerHTML = `
                    <span class="text-slate-400">${SHORTCUT_LABELS[action]}</span>
                    <span class="flex items-center gap-1">
                        <kbd class="kbd" data-kbd-for="${action}">${key.toUpperCase()}</kbd>
                        <button class="shortcut-edit-btn" data-edit-action="${action}" title="Redefinir tecla"><i class="fa-solid fa-pen"></i></button>
                    </span>`;
                listEl.appendChild(row);
            });

            // Atalhos fixos (não remapeáveis, usam Ctrl/Cmd)
            [['Desfazer', 'Ctrl+Z'], ['Refazer', 'Ctrl+Y'], ['Exportar', 'Ctrl+S'], ['Fechar popups', 'Esc']].forEach(([label, key]) => {
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                row.innerHTML = `<span class="text-slate-400">${label}</span><kbd class="kbd">${key}</kbd>`;
                listEl.appendChild(row);
            });

            listEl.querySelectorAll('[data-edit-action]').forEach(btn => {
                btn.addEventListener('click', () => startListeningForShortcut(btn.dataset.editAction));
            });
        }

        function startListeningForShortcut(action) {
            listeningForAction = action;
            const kbd = document.querySelector(`kbd[data-kbd-for="${action}"]`);
            if (kbd) { kbd.textContent = '...'; kbd.classList.add('listening'); }
            showToast('Pressione a nova tecla (Esc cancela)', 'info');
        }

        document.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            const isTyping = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

            // Captura da nova tecla ao redefinir um atalho
            if (listeningForAction) {
                e.preventDefault();
                const action = listeningForAction;
                listeningForAction = null;
                if (e.key === 'Escape') { renderShortcutsList(); return; }
                const newKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();

                // Se a tecla já pertence a outra ação, libera-a (troca simples de posição).
                const conflictAction = Object.keys(SHORTCUTS).find(a => a !== action && SHORTCUTS[a] === newKey);
                if (conflictAction) {
                    delete SHORTCUTS[conflictAction];
                    showToast(`Tecla "${newKey.toUpperCase()}" removida de "${SHORTCUT_LABELS[conflictAction]}"`, 'warning');
                }
                SHORTCUTS[action] = newKey;
                saveShortcutsToStorage();
                renderShortcutsList();
                showToast(`"${SHORTCUT_LABELS[action]}" agora é "${newKey.toUpperCase()}"`, 'success');
                return;
            }

            if (e.key === 'Escape') {
                closeAllModals();
                POPOVER_IDS.forEach(id => document.getElementById(id)?.classList.add('opacity-0', 'scale-95', 'invisible'));
                return;
            }

            if (isTyping) return;

            // Atalhos com Ctrl/Cmd
            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
                if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
                if (key === 's') { e.preventDefault(); exportPngFlattened('minecraft-skin.png', 64); showToast('Skin 64×64 exportada!', 'success'); return; }
                return;
            }

            const key = e.key.toLowerCase();

            const matchedTool = Object.keys(SHORTCUTS).find(action => TOOL_ACTIONS.has(action) && SHORTCUTS[action] === key);
            if (matchedTool) {
                document.querySelector(`.tool-btn[data-tool="${matchedTool}"]`)?.click();
                return;
            }

            if (key === SHORTCUTS.brush_dec) { updateBrushSize(State.brushSize - 1); return; }
            if (key === SHORTCUTS.brush_inc) { updateBrushSize(State.brushSize + 1); return; }
            if (key === '?') { openModal('modal-help'); renderShortcutsList(); return; }
        });

        // ===================== MOTOR DE COLAGEM & PROJEÇÃO DE IMAGEM =====================
        // Objetos flutuantes (imagens importadas) que podem ser movidos, redimensionados,
        // rotacionados e filtrados antes de serem "projetados" (achatados) na camada ativa.
        // Simplificação assumida: os manípulos de redimensionar/mover usam sempre a caixa
        // delimitadora NÃO rotacionada do objeto (mesmo que a imagem em si já apareça
        // rotacionada) — isso mantém a interação simples e previsível.

        const canvasCollage = document.getElementById('canvas-collage');
        const ctxCollage = canvasCollage.getContext('2d');
        let collageDrag = null; // { type: 'move'|'resize'|'rotate', corner, objId, startMouse, startObj }

        function createCollageObjectFromImage(img) {
            const maxDim = 40;
            let w = img.naturalWidth || 32, h = img.naturalHeight || 32;
            const scale = Math.min(maxDim / w, maxDim / h, 1) || 1;
            w *= scale; h *= scale;

            const obj = {
                id: newId('collage'), img,
                x: 32 - w / 2, y: 32 - h / 2, w, h,
                rotation: 0, opacity: 100, brightness: 100, contrast: 100, saturation: 100,
                flipH: false, flipV: false,
                pixelize: false, pixelSize: 4,
                removeBg: false, removeBgColor: '#ffffff', removeBgTolerance: 30,
                _processedCanvas: null
            };
            State.collageObjects.push(obj);
            State.selectedCollageId = obj.id;
            renderCollageObjectsList();
            syncCollageBar();
            renderCollageCanvas();
            return obj;
        }

        // Remove por chave de cor (croma) — pixels próximos da cor escolhida viram transparentes.
        function applyChromaKey(sourceCanvas, colorHex, tolerance) {
            const w = sourceCanvas.width, h = sourceCanvas.height;
            const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(sourceCanvas, 0, 0);
            const imgData = tctx.getImageData(0, 0, w, h);
            const d = imgData.data;
            const target = hexToRgb(colorHex);
            for (let i = 0; i < d.length; i += 4) {
                const dist = Math.abs(d[i] - target.r) + Math.abs(d[i+1] - target.g) + Math.abs(d[i+2] - target.b);
                if (dist <= tolerance) d[i + 3] = 0;
            }
            tctx.putImageData(imgData, 0, 0);
            return tmp;
        }

        // Pixeliza reduzindo a imagem e ampliando de volta sem suavização.
        function applyPixelize(sourceCanvas, blockSize) {
            const w = sourceCanvas.width, h = sourceCanvas.height;
            const smallW = Math.max(1, Math.round(w / blockSize));
            const smallH = Math.max(1, Math.round(h / blockSize));
            const small = document.createElement('canvas'); small.width = smallW; small.height = smallH;
            small.getContext('2d').drawImage(sourceCanvas, 0, 0, smallW, smallH);
            const out = document.createElement('canvas'); out.width = w; out.height = h;
            const octx = out.getContext('2d');
            octx.imageSmoothingEnabled = false;
            octx.drawImage(small, 0, 0, w, h);
            return out;
        }

        // Recalcula (e armazena em cache) a versão processada da imagem do objeto — só
        // precisa rodar quando remover-fundo/pixelizar mudam, não a cada frame de arraste.
        function refreshObjectProcessing(obj) {
            if (!obj.removeBg && !obj.pixelize) { obj._processedCanvas = null; return; }
            let src = document.createElement('canvas');
            src.width = obj.img.naturalWidth || obj.w;
            src.height = obj.img.naturalHeight || obj.h;
            src.getContext('2d').drawImage(obj.img, 0, 0, src.width, src.height);
            if (obj.removeBg) src = applyChromaKey(src, obj.removeBgColor, obj.removeBgTolerance);
            if (obj.pixelize) src = applyPixelize(src, obj.pixelSize);
            obj._processedCanvas = src;
        }

        function drawCollageObject(ctx, obj) {
            const source = obj._processedCanvas || obj.img;
            ctx.save();
            ctx.globalAlpha = obj.opacity / 100;
            ctx.filter = `brightness(${obj.brightness}%) contrast(${obj.contrast}%) saturate(${obj.saturation}%)`;
            const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate(obj.rotation * Math.PI / 180);
            ctx.scale(obj.flipH ? -1 : 1, obj.flipV ? -1 : 1);
            ctx.drawImage(source, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
            ctx.restore();
        }

        function drawCollageHandles(ctx, obj) {
            ctx.save();
            ctx.strokeStyle = '#ec4899';
            ctx.lineWidth = 0.4;
            ctx.setLineDash([1.5, 1]);
            ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
            ctx.setLineDash([]);
            ctx.fillStyle = '#ec4899';
            [[obj.x, obj.y], [obj.x + obj.w, obj.y], [obj.x + obj.w, obj.y + obj.h], [obj.x, obj.y + obj.h]].forEach(([cx, cy]) => {
                ctx.fillRect(cx - 1.4, cy - 1.4, 2.8, 2.8);
            });
            const topMidX = obj.x + obj.w / 2, topMidY = obj.y;
            ctx.beginPath();
            ctx.moveTo(topMidX, topMidY);
            ctx.lineTo(topMidX, topMidY - 6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(topMidX, topMidY - 6, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function renderCollageCanvas() {
            ctxCollage.clearRect(0, 0, 64, 64);
            State.collageObjects.forEach(obj => drawCollageObject(ctxCollage, obj));
            const sel = State.collageObjects.find(o => o.id === State.selectedCollageId);
            if (sel) drawCollageHandles(ctxCollage, sel);
        }

        function renderCollageObjectsList() {
            const listEl = document.getElementById('collage-objects-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            if (State.collageObjects.length === 0) {
                listEl.innerHTML = '<span class="text-[10px] text-slate-600 italic px-1">Nenhum objeto ainda — adicione uma imagem acima</span>';
                return;
            }
            State.collageObjects.forEach((obj, idx) => {
                const row = document.createElement('div');
                row.className = `flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition ${obj.id === State.selectedCollageId ? 'border-pink-500 bg-pink-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`;
                row.innerHTML = `<i class="fa-solid fa-image text-pink-400 text-xs"></i><span class="text-xs text-slate-300 flex-1">Imagem ${idx + 1}</span>`;
                row.addEventListener('click', () => {
                    State.selectedCollageId = obj.id;
                    syncCollageBar();
                    renderCollageObjectsList();
                    renderCollageCanvas();
                });
                const delBtn = document.createElement('button');
                delBtn.className = 'text-slate-500 hover:text-red-400 px-1';
                delBtn.innerHTML = '<i class="fa-solid fa-trash text-[10px]"></i>';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    State.collageObjects = State.collageObjects.filter(o => o.id !== obj.id);
                    if (State.selectedCollageId === obj.id) State.selectedCollageId = null;
                    renderCollageObjectsList();
                    syncCollageBar();
                    renderCollageCanvas();
                });
                row.appendChild(delBtn);
                listEl.appendChild(row);
            });
        }

        function syncCollageBar() {
            const obj = State.collageObjects.find(o => o.id === State.selectedCollageId);
            const noSel = document.getElementById('collage-no-selection');
            const controls = document.getElementById('collage-selection-controls');
            if (!obj) {
                noSel?.classList.remove('hidden');
                controls?.classList.add('hidden');
                return;
            }
            noSel?.classList.add('hidden');
            controls?.classList.remove('hidden');
            document.getElementById('collage-opacity').value = obj.opacity;
            document.getElementById('collage-brightness').value = obj.brightness;
            document.getElementById('collage-contrast').value = obj.contrast;
            document.getElementById('collage-saturation').value = obj.saturation;
            document.getElementById('collage-rotation').value = ((obj.rotation % 360) + 360) % 360;
            document.getElementById('collage-pixelize-toggle').checked = obj.pixelize;
            document.getElementById('collage-pixelize-size').value = obj.pixelSize;
            document.getElementById('collage-removebg-toggle').checked = obj.removeBg;
            document.getElementById('collage-removebg-color').value = obj.removeBgColor;
            document.getElementById('collage-removebg-tolerance').value = obj.removeBgTolerance;
        }

        function getSelectedCollageObject() {
            return State.collageObjects.find(o => o.id === State.selectedCollageId) || null;
        }

        // --- Interação: mover / redimensionar / rotacionar no canvas-collage ---
        function getCollageMousePos(e) {
            const rect = canvasCollage.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) / rect.width * 64,
                y: (e.clientY - rect.top) / rect.height * 64
            };
        }
        function hitTestCollageObject(obj, pos) {
            const hs = 3;
            const corners = [
                { x: obj.x, y: obj.y, type: 'tl' },
                { x: obj.x + obj.w, y: obj.y, type: 'tr' },
                { x: obj.x + obj.w, y: obj.y + obj.h, type: 'br' },
                { x: obj.x, y: obj.y + obj.h, type: 'bl' }
            ];
            for (const c of corners) {
                if (Math.abs(pos.x - c.x) <= hs && Math.abs(pos.y - c.y) <= hs) return { type: 'resize', corner: c.type };
            }
            const rot = { x: obj.x + obj.w / 2, y: obj.y - 6 };
            if (Math.abs(pos.x - rot.x) <= hs && Math.abs(pos.y - rot.y) <= hs) return { type: 'rotate' };
            if (pos.x >= obj.x && pos.x <= obj.x + obj.w && pos.y >= obj.y && pos.y <= obj.y + obj.h) return { type: 'move' };
            return null;
        }

        canvasCollage.addEventListener('mousedown', (e) => {
            if (State.activeTool !== 'collage') return;
            const pos = getCollageMousePos(e);
            let hit = null, hitObj = null;

            const selected = getSelectedCollageObject();
            if (selected) {
                const h = hitTestCollageObject(selected, pos);
                if (h && h.type !== 'move') { hit = h; hitObj = selected; }
            }
            if (!hit) {
                for (let i = State.collageObjects.length - 1; i >= 0; i--) {
                    const h = hitTestCollageObject(State.collageObjects[i], pos);
                    if (h) { hit = h; hitObj = State.collageObjects[i]; break; }
                }
            }
            if (!hitObj) {
                State.selectedCollageId = null;
                syncCollageBar();
                renderCollageCanvas();
                return;
            }
            State.selectedCollageId = hitObj.id;
            syncCollageBar();
            renderCollageObjectsList();
            collageDrag = { type: hit.type, corner: hit.corner, objId: hitObj.id, startMouse: pos, startObj: { ...hitObj } };
            renderCollageCanvas();
        });

        canvasCollage.addEventListener('mousemove', (e) => {
            if (!collageDrag) return;
            const pos = getCollageMousePos(e);
            const obj = State.collageObjects.find(o => o.id === collageDrag.objId);
            if (!obj) return;
            const dx = pos.x - collageDrag.startMouse.x;
            const dy = pos.y - collageDrag.startMouse.y;
            const s = collageDrag.startObj;
            const minSize = 4;

            if (collageDrag.type === 'move') {
                obj.x = s.x + dx;
                obj.y = s.y + dy;
            } else if (collageDrag.type === 'resize') {
                if (collageDrag.corner === 'br') {
                    obj.w = Math.max(minSize, s.w + dx);
                    obj.h = Math.max(minSize, s.h + dy);
                } else if (collageDrag.corner === 'tl') {
                    obj.w = Math.max(minSize, s.w - dx);
                    obj.h = Math.max(minSize, s.h - dy);
                    obj.x = s.x + (s.w - obj.w);
                    obj.y = s.y + (s.h - obj.h);
                } else if (collageDrag.corner === 'tr') {
                    obj.w = Math.max(minSize, s.w + dx);
                    obj.h = Math.max(minSize, s.h - dy);
                    obj.y = s.y + (s.h - obj.h);
                } else if (collageDrag.corner === 'bl') {
                    obj.w = Math.max(minSize, s.w - dx);
                    obj.h = Math.max(minSize, s.h + dy);
                    obj.x = s.x + (s.w - obj.w);
                }
            } else if (collageDrag.type === 'rotate') {
                const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
                const angle = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI + 90;
                obj.rotation = angle;
                const rotInput = document.getElementById('collage-rotation');
                if (rotInput) rotInput.value = ((angle % 360) + 360) % 360;
            }
            renderCollageCanvas();
        });

        window.addEventListener('mouseup', () => { collageDrag = null; });

        // --- Entrada de imagens ---
        document.getElementById('input-collage-image')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    createCollageObjectFromImage(img);
                    showToast('Imagem adicionada à composição', 'success');
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        // --- Barra de propriedades do objeto selecionado ---
        document.getElementById('collage-opacity')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.opacity = parseInt(e.target.value); renderCollageCanvas(); } });
        document.getElementById('collage-brightness')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.brightness = parseInt(e.target.value); renderCollageCanvas(); } });
        document.getElementById('collage-contrast')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.contrast = parseInt(e.target.value); renderCollageCanvas(); } });
        document.getElementById('collage-saturation')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.saturation = parseInt(e.target.value); renderCollageCanvas(); } });
        document.getElementById('collage-rotation')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.rotation = parseInt(e.target.value); renderCollageCanvas(); } });
        document.getElementById('collage-flip-h')?.addEventListener('click', () => { const o = getSelectedCollageObject(); if (o) { o.flipH = !o.flipH; renderCollageCanvas(); } });
        document.getElementById('collage-flip-v')?.addEventListener('click', () => { const o = getSelectedCollageObject(); if (o) { o.flipV = !o.flipV; renderCollageCanvas(); } });

        document.getElementById('collage-pixelize-toggle')?.addEventListener('change', (e) => { const o = getSelectedCollageObject(); if (o) { o.pixelize = e.target.checked; refreshObjectProcessing(o); renderCollageCanvas(); } });
        document.getElementById('collage-pixelize-size')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.pixelSize = parseInt(e.target.value); if (o.pixelize) { refreshObjectProcessing(o); renderCollageCanvas(); } } });
        document.getElementById('collage-removebg-toggle')?.addEventListener('change', (e) => { const o = getSelectedCollageObject(); if (o) { o.removeBg = e.target.checked; refreshObjectProcessing(o); renderCollageCanvas(); } });
        document.getElementById('collage-removebg-color')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.removeBgColor = e.target.value; if (o.removeBg) { refreshObjectProcessing(o); renderCollageCanvas(); } } });
        document.getElementById('collage-removebg-tolerance')?.addEventListener('input', (e) => { const o = getSelectedCollageObject(); if (o) { o.removeBgTolerance = parseInt(e.target.value); if (o.removeBg) { refreshObjectProcessing(o); renderCollageCanvas(); } } });

        document.getElementById('collage-duplicate')?.addEventListener('click', () => {
            const o = getSelectedCollageObject();
            if (!o) return;
            const copy = { ...o, id: newId('collage'), x: o.x + 3, y: o.y + 3 };
            State.collageObjects.push(copy);
            State.selectedCollageId = copy.id;
            renderCollageObjectsList();
            syncCollageBar();
            renderCollageCanvas();
            showToast('Objeto duplicado', 'success');
        });
        document.getElementById('collage-delete')?.addEventListener('click', () => {
            const o = getSelectedCollageObject();
            if (!o) return;
            State.collageObjects = State.collageObjects.filter(x => x.id !== o.id);
            State.selectedCollageId = null;
            renderCollageObjectsList();
            syncCollageBar();
            renderCollageCanvas();
        });

        // --- Aplicar (projetar) a composição inteira na camada ativa ---
        document.getElementById('btn-collage-apply')?.addEventListener('click', () => {
            const activeLayer = State.layers[State.activeLayerIndex];
            if (!activeLayer) return;
            if (activeLayer.locked) { showToast('Camada ativa bloqueada! Destrave para editar.', 'warning'); return; }
            if (State.collageObjects.length === 0) { showToast('Nada para aplicar ainda', 'info'); togglePopover('popover-collage'); return; }

            State.collageObjects.forEach(obj => drawCollageObject(activeLayer.ctx, obj));
            State.collageObjects = [];
            State.selectedCollageId = null;
            ctxCollage.clearRect(0, 0, 64, 64);
            renderCollageObjectsList();
            syncCollageBar();
            render2DCanvas();
            saveHistoryState();
            showToast('Colagem projetada na textura!', 'success');
            togglePopover('popover-collage');
        });

        // --- Biblioteca de Elementos (Hair/Eyes/Clothes/Outros, salvos no IndexedDB) ---
        async function refreshElementsLibrary() {
            const grid = document.getElementById('elements-library-grid');
            const emptyMsg = document.getElementById('elements-library-empty');
            const category = document.getElementById('select-element-category')?.value || 'Outros';
            if (!grid) return;

            const all = await idbGetAll('elements');
            const items = all.filter(el => el.category === category).sort((a, b) => b.createdAt - a.createdAt);
            grid.innerHTML = '';
            if (emptyMsg) emptyMsg.classList.toggle('hidden', items.length > 0);

            items.forEach(el => {
                const wrap = document.createElement('div');
                wrap.className = 'relative group';
                const btn = document.createElement('button');
                btn.className = 'w-full aspect-square rounded-lg checkerboard border border-slate-700 overflow-hidden hover:border-pink-400 transition';
                btn.innerHTML = `<img src="${el.thumbnail}" class="w-full h-full object-contain" style="image-rendering:pixelated;">`;
                btn.title = el.name;
                btn.addEventListener('click', () => {
                    const img = new Image();
                    img.onload = () => { createCollageObjectFromImage(img); showToast(`"${el.name}" adicionado à composição`, 'success'); };
                    img.src = el.thumbnail;
                });
                const delBtn = document.createElement('button');
                delBtn.className = 'absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] items-center justify-center hidden group-hover:flex';
                delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await idbDelete('elements', el.id);
                    refreshElementsLibrary();
                });
                wrap.appendChild(btn);
                wrap.appendChild(delBtn);
                grid.appendChild(wrap);
            });
        }
        document.getElementById('select-element-category')?.addEventListener('change', refreshElementsLibrary);

        document.getElementById('collage-save-element')?.addEventListener('click', () => {
            const o = getSelectedCollageObject();
            if (!o) return;
            showRenameModal('Meu Elemento', async (name) => {
                const tmp = document.createElement('canvas');
                tmp.width = Math.max(1, Math.round(o.w));
                tmp.height = Math.max(1, Math.round(o.h));
                const tctx = tmp.getContext('2d');
                tctx.filter = `brightness(${o.brightness}%) contrast(${o.contrast}%) saturate(${o.saturation}%)`;
                tctx.drawImage(o._processedCanvas || o.img, 0, 0, tmp.width, tmp.height);
                const category = document.getElementById('select-element-category')?.value || 'Outros';
                await idbPut('elements', {
                    id: newId('elem'), name, category,
                    thumbnail: tmp.toDataURL('image/png'),
                    createdAt: Date.now()
                });
                refreshElementsLibrary();
                showToast(`"${name}" salvo na biblioteca (${category})`, 'success');
            });
        });


        window.onload = async function() {
            await initIndexedDB();
            loadShortcuts(); // Carrega atalhos customizados (ou os padrões)
            loadFavoritesFromStorage(); // Carrega cores favoritas salvas
            loadSavedPalettesFromStorage(); // Carrega paletas salvas
            initPalette();
            initStampsUI();
            setSecondaryColor(State.secondaryColor); // Sincroniza o swatch da cor secundária
            setCurrentColor(State.currentColor); // Sincroniza o hex exibido com a cor inicial
            renderRecentColors();
            updateBrushSize(State.brushSize); // Sincroniza o slider/preview do pincel
            drawTemplateGuide(); // Desenha o template (inicia invisível)
            renderTemplateLegend(); // Monta a legenda de cores do template
            initRemovePartUI(); // Monta o menu "Remover Parte" da camada ativa
            initFiltersUI(); // Monta o menu "Filtros"
            initCopyPasteUI(); // Monta os menus "Espelhar Parte" e "Copiar/Colar"
            updateProjectLabel(); // Sincroniza o nome do projeto exibido no cabeçalho
            renderCollageObjectsList(); // Lista de objetos de colagem (inicia vazia)
            syncCollageBar(); // Estado inicial da barra de propriedades de colagem
            refreshElementsLibrary(); // Biblioteca de elementos (Cabelo/Olhos/Roupas/Outros)
            
            // Forçamos o carregamento da grid primeiro
            init3D(); 
            
            const restored = await loadFromBrowserStorage();
            if (!restored) {
                initLayers();
            } else {
                render2DCanvas();
            }
            markChangesSaved(); // Estado recém-carregado não conta como "alteração não salva"
        };
