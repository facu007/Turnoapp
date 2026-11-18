// TurnosApp SaaS Platform — Full Functional Controller (Frontend + Backend Sync)
(function () {
  const STORAGE_KEY = 'turnosapp_saas_state_v2';
  const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('turnosapp_sync') : null;

  let state = JSON.parse(JSON.stringify(window.INITIAL_DATA));

  // Check URL params for public mode (/studiobellas or ?mode=public)
  const urlParams = new URLSearchParams(window.location.search);
  const initialMode =
    window.location.pathname.includes('studiobellas') || urlParams.get('mode') === 'public'
      ? 'public'
      : 'admin';

  const ALL_DAYS = [
    { label: 'Lun', name: 'Lunes', num: '16', date: '2026-11-16', dayCol: 0, fullLabel: 'Lunes, 16 de Noviembre', shortLabel: 'Lun 16 Nov' },
    { label: 'Hoy', name: 'Martes (Hoy)', num: '17', date: '2026-11-17', dayCol: 1, fullLabel: 'Martes, 17 de Noviembre', shortLabel: 'Hoy 17 Nov', isToday: true },
    { label: 'Mié', name: 'Miércoles', num: '18', date: '2026-11-18', dayCol: 2, fullLabel: 'Miércoles, 18 de Noviembre', shortLabel: 'Mié 18 Nov' },
    { label: 'Jue', name: 'Jueves', num: '19', date: '2026-11-19', dayCol: 3, fullLabel: 'Jueves, 19 de Noviembre', shortLabel: 'Jue 19 Nov' },
    { label: 'Vie', name: 'Viernes', num: '20', date: '2026-11-20', dayCol: 4, fullLabel: 'Viernes, 20 de Noviembre', shortLabel: 'Vie 20 Nov' },
    { label: 'Sáb', name: 'Sábado', num: '21', date: '2026-11-21', dayCol: 5, fullLabel: 'Sábado, 21 de Noviembre', shortLabel: 'Sáb 21 Nov', isSat: true }
  ];

  const PUBLIC_DAYS = ALL_DAYS.slice(1); // Mar 17 to Sáb 21
  const PUBLIC_MORNING_SLOTS = ['09:30', '10:30', '11:15'];
  const PUBLIC_AFTERNOON_SLOTS = ['14:00', '15:00', '16:30', '17:15', '18:00', '19:00'];

  let ui = {
    mode: initialMode, // 'admin' | 'public'
    tab: 'dashboard', // 'dashboard' | 'calendar' | 'clients' | 'services' | 'specialists' | 'reminders' | 'analytics' | 'plans'
    dashboardDate: '2026-11-17',
    dashboardFilter: 'all', // 'all' | 'confirmed' | 'pending'
    calendarSpecialist: 'all', // 'all' | 'sm' | 'mc' | 'ar'
    calendarViewMode: 'week', // 'day' | 'week' | 'month'
    calendarSelectedDate: '2026-11-17',
    calendarWeekOffset: 0,
    clientFilter: 'all', // 'all' | 'frecuente' | 'nuevo'
    clientSearch: '',
    clientPage: 1,
    clientPageSize: 4,
    selectedClientId: 'cli-1',
    analyticsPeriod: '30d', // 'month' | '30d' | 'quarter'
    activeMenuAptId: null,
    reminderPreviewAptId: 'apt-1',
    publicBooking: {
      serviceId: 'srv-1',
      specialistId: 'any',
      dayIndex: 0, // index in PUBLIC_DAYS (0 = Hoy 17)
      time: '15:00',
      clientName: 'Laura Benítez',
      clientPhone: '+54 9 11 6543-2109',
      clientNotes: '',
      confirmedReceipt: null
    }
  };

  // Load state from backend API (or localStorage fallback)
  async function initState() {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && serverData.business) {
          state = serverData;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          render();
          return;
        }
      }
    } catch (e) {
      // Fallback to localStorage when opened via file://
      try {
        const local = localStorage.getItem(STORAGE_KEY);
        if (local) state = JSON.parse(local);
      } catch (_) {}
    }
    render();
  }

  async function persistState(broadcast = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
    } catch (_) {}
    if (broadcast && syncChannel) {
      try {
        syncChannel.postMessage({ type: 'STATE_UPDATED', state });
      } catch (_) {}
    }
  }

  if (syncChannel) {
    syncChannel.onmessage = (ev) => {
      if (ev.data && ev.data.type === 'STATE_UPDATED' && ev.data.state) {
        state = ev.data.state;
        render();
      }
    };
  }

  function formatARS(num) {
    return '$' + Number(num || 0).toLocaleString('es-AR');
  }

  function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] ? parts[0].slice(0, 2) : 'CL').toUpperCase();
  }

  function mapTimeToRowBlock(time) {
    const hour = parseInt(String(time || '14:00').split(':')[0], 10);
    const min = parseInt(String(time || '14:00').split(':')[1] || '0', 10);
    if (hour <= 9) return '09:00';
    if (hour === 10) return '10:30';
    if (hour === 11 || hour === 12) return '11:15';
    return '14:00';
  }

  function getDayInfoByDate(dateStr) {
    return ALL_DAYS.find((d) => d.date === dateStr) || ALL_DAYS[1];
  }

  // Check if a slot is occupied for a given date, time, and specialist
  function isSlotOccupied(dateStr, timeStr, specialistId) {
    // Check manual blocked slots
    const isBlocked = (state.blockedSlots || []).some(
      (b) => b.date === dateStr && (b.time === timeStr || b.rowBlock === mapTimeToRowBlock(timeStr)) && (b.specialistId === 'all' || b.specialistId === specialistId)
    );
    if (isBlocked) return true;

    if (specialistId === 'any') {
      // Occupied only if ALL specialists are busy at that date+time
      return state.specialists.every((sp) =>
        state.appointments.some(
          (a) => a.date === dateStr && a.time === timeStr && a.specialistId === sp.id && a.status !== 'cancelled'
        )
      );
    }

    return state.appointments.some(
      (a) => a.date === dateStr && a.time === timeStr && a.specialistId === specialistId && a.status !== 'cancelled'
    );
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bgClass =
      type === 'success'
        ? 'bg-brand-roble text-white border-accent'
        : type === 'warning'
        ? 'bg-warning-container text-on-warning-container border-warning'
        : 'bg-primary text-white border-primary-container';
    const icon = type === 'success' ? 'check_circle' : type === 'warning' ? 'warning' : 'info';

    toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border-l-4 ${bgClass} text-body-sm font-medium transform transition-all duration-300 translate-y-2 opacity-0`;
    toast.innerHTML = `
      <span class="material-symbols-outlined text-title-lg ${type === 'success' ? 'text-accent' : ''}">${icon}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });
    setTimeout(() => {
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function openModal(htmlContent) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-brand-roble/60 backdrop-blur-xs p-4 animate-fadeIn overflow-y-auto" id="modal-backdrop">
        <div class="bg-surface rounded-lg border border-outline-variant shadow-2xl max-w-lg w-full overflow-hidden my-8" onclick="event.stopPropagation()">
          ${htmlContent}
        </div>
      </div>
    `;
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeModal);
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }

  // Expose full interactive controller
  window.TurnosApp = {
    setMode(mode) {
      ui.mode = mode;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    setTab(tab) {
      ui.mode = 'admin';
      ui.tab = tab;
      ui.activeMenuAptId = null;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    copyBusinessLink() {
      const publicUrl = `${window.location.origin}/?mode=public`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(publicUrl).catch(() => {});
      }
      showToast(`Enlace copiado al portapapeles (${state.business.url})`);
    },
    async resetDemoData() {
      try {
        const res = await fetch('/api/reset', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          state = data.state;
        } else {
          state = JSON.parse(JSON.stringify(window.INITIAL_DATA));
        }
      } catch (_) {
        state = JSON.parse(JSON.stringify(window.INITIAL_DATA));
      }
      await persistState();
      showToast('Base de datos restaurada al estado original de demostración.');
      render();
    },

    // Dashboard actions
    setDashboardDate(dateStr) {
      ui.dashboardDate = dateStr;
      render();
    },
    shiftDashboardDate(delta) {
      const idx = ALL_DAYS.findIndex((d) => d.date === ui.dashboardDate);
      const nextIdx = Math.max(0, Math.min(ALL_DAYS.length - 1, (idx === -1 ? 1 : idx) + delta));
      ui.dashboardDate = ALL_DAYS[nextIdx].date;
      render();
    },
    setDashboardFilter(filter) {
      ui.dashboardFilter = filter;
      render();
    },
    async approveAppointment(aptId) {
      const apt = state.appointments.find((a) => a.id === aptId);
      if (apt) {
        apt.status = 'confirmed';
        // Update client lastVisit if pending
        const cli = state.clients.find((c) => c.id === apt.clientId || c.name === apt.clientName);
        if (cli && cli.lastVisit.includes('Pend')) {
          cli.lastVisit = `Hoy ${apt.time}`;
        }
        state.business.whatsappBot.sentToday += 1;
        state.business.whatsappBot.logs.unshift({
          id: 'log-' + Date.now(),
          time: new Date().toTimeString().slice(0, 5),
          clientName: apt.clientName,
          phone: cli ? cli.phone : '+54 9 11 5555-0000',
          service: apt.shortService || apt.serviceName,
          status: 'Confirmación aprobada enviada'
        });
        await persistState();
        showToast(`Turno de ${apt.clientName} (${apt.time} hs) aprobado y confirmado por WhatsApp.`);
        render();
      }
    },
    async completeAppointment(aptId) {
      const apt = state.appointments.find((a) => a.id === aptId);
      ui.activeMenuAptId = null;
      if (apt) {
        apt.status = 'completed';
        await persistState();
        showToast(`Sesión de ${apt.clientName} marcada como concluida y cobrada (${formatARS(apt.price)}).`);
        render();
      }
    },
    async discardAppointment(aptId) {
      const idx = state.appointments.findIndex((a) => a.id === aptId);
      ui.activeMenuAptId = null;
      if (idx !== -1) {
        const apt = state.appointments[idx];
        state.appointments.splice(idx, 1);
        await persistState();
        closeModal();
        showToast(`Turno de ${apt.clientName} eliminado de la agenda.`, 'warning');
        render();
      }
    },
    toggleAptMenu(aptId, event) {
      if (event) event.stopPropagation();
      ui.activeMenuAptId = ui.activeMenuAptId === aptId ? null : aptId;
      render();
    },
    async sendWhatsAppReminder(aptId, openExternal = false) {
      const apt = state.appointments.find((a) => a.id === aptId) || state.appointments[0];
      ui.activeMenuAptId = null;
      if (!apt) return;
      const cli = state.clients.find((c) => c.id === apt.clientId || c.name === apt.clientName);
      const phoneClean = cli ? cli.phoneClean : '5491145218899';
      const dayInfo = getDayInfoByDate(apt.date);

      const message = state.business.whatsappBot.template24h
        .replace('{{nombre}}', apt.clientName)
        .replace('{{servicio}}', apt.serviceName)
        .replace('{{especialista}}', apt.specialistName)
        .replace('{{fecha}}', dayInfo.shortLabel)
        .replace('{{hora}}', apt.time)
        .replace('{{direccion}}', state.business.address);

      state.business.whatsappBot.sentToday += 1;
      state.business.whatsappBot.logs.unshift({
        id: 'log-' + Date.now(),
        time: new Date().toTimeString().slice(0, 5),
        clientName: apt.clientName,
        phone: cli ? cli.phone : '+54 9 11 4521-8899',
        service: apt.shortService || apt.serviceName,
        status: 'Recordatorio enviado'
      });

      await persistState();
      if (openExternal) {
        window.open(`https://wa.me/${phoneClean}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      }
      showToast(`Recordatorio WhatsApp enviado a ${apt.clientName} (${apt.time} hs).`);
      render();
    },
    viewClientFromApt(aptId) {
      const apt = state.appointments.find((a) => a.id === aptId);
      ui.activeMenuAptId = null;
      if (apt) {
        const cli = state.clients.find((c) => c.id === apt.clientId || c.name.toLowerCase() === apt.clientName.toLowerCase());
        if (cli) ui.selectedClientId = cli.id;
      }
      ui.tab = 'clients';
      render();
    },

    // Open New / Edit Appointment Modal
    openAppointmentModal(aptId = null, defaults = {}) {
      ui.activeMenuAptId = null;
      const existing = aptId ? state.appointments.find((a) => a.id === aptId) : null;
      const isEdit = Boolean(existing);

      const defaultDate = existing ? existing.date : defaults.date || ui.dashboardDate || '2026-11-17';
      const defaultTime = existing ? existing.time : defaults.time || '15:00';
      const defaultClientName = existing ? existing.clientName : defaults.clientName || '';
      const defaultServiceId = existing ? existing.serviceId : defaults.serviceId || state.services[0]?.id || 'srv-1';
      const defaultSpecId = existing ? existing.specialistId : defaults.specialistId || state.specialists[0]?.id || 'sm';
      const defaultStatus = existing ? existing.status : 'confirmed';
      const defaultNotes = existing ? existing.notes || '' : '';

      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">${isEdit ? 'Gestión de Reserva' : 'Reserva Concierge'}</span>
            <h3 class="font-display text-headline-lg italic text-white">${isEdit ? `Editar Turno — ${existing.clientName}` : 'Agendar Nueva Cita'}</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitAppointmentForm(event, '${existing ? existing.id : ''}')" class="p-6 flex flex-col gap-4 text-body-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Cliente *</label>
              <input type="text" name="clientName" required placeholder="Ej: Carolina Herrera" value="${defaultClientName}" list="crm-clients-list" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm focus:border-primary focus:ring-1 focus:ring-primary">
              <datalist id="crm-clients-list">
                ${state.clients.map((c) => `<option value="${c.name}">`).join('')}
              </datalist>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">WhatsApp de contacto</label>
              <input type="tel" name="phone" placeholder="+54 9 11 5555-4444" value="+54 9 11 5432-1987" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm focus:border-primary focus:ring-1 focus:ring-primary">
            </div>
          </div>

          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Tratamiento / Servicio *</label>
            <select name="serviceId" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm focus:border-primary">
              ${state.services
                .map(
                  (s) =>
                    `<option value="${s.id}" ${s.id === defaultServiceId ? 'selected' : ''}>${s.name} (${s.duration} min — ${formatARS(s.price)})</option>`
                )
                .join('')}
            </select>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Especialista</label>
              <select name="specialistId" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
                ${state.specialists
                  .map(
                    (sp) =>
                      `<option value="${sp.id}" ${sp.id === defaultSpecId ? 'selected' : ''}>${sp.name}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Día</label>
              <select name="date" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
                ${ALL_DAYS.map(
                  (d) => `<option value="${d.date}" ${d.date === defaultDate ? 'selected' : ''}>${d.shortLabel}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Horario</label>
              <select name="time" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
                ${['09:00', '09:15', '09:30', '10:30', '11:15', '11:30', '14:00', '15:00', '16:30', '17:15', '18:00', '19:00']
                  .map((t) => `<option value="${t}" ${t === defaultTime ? 'selected' : ''}>${t} hs</option>`)
                  .join('')}
              </select>
            </div>
          </div>

          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Estado del turno</label>
            <div class="flex items-center gap-4 pt-1 flex-wrap">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="status" value="confirmed" ${defaultStatus === 'confirmed' ? 'checked' : ''} class="text-primary focus:ring-primary">
                <span>Confirmado</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="status" value="pending" ${defaultStatus === 'pending' ? 'checked' : ''} class="text-primary focus:ring-primary">
                <span>Pendiente de aprobar</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="status" value="completed" ${defaultStatus === 'completed' ? 'checked' : ''} class="text-primary focus:ring-primary">
                <span>Concluido / Cobrado</span>
              </label>
            </div>
          </div>

          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Notas operativas de la sesión</label>
            <input type="text" name="notes" value="${defaultNotes}" placeholder="Ej: Aplicar ampolla nutritiva sin cargo, prefiere box silencioso..." class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
          </div>

          <div class="flex items-center justify-between pt-4 border-t border-outline-variant mt-2">
            ${
              isEdit
                ? `<button type="button" onclick="TurnosApp.discardAppointment('${existing.id}')" class="px-3.5 py-2 border border-error/40 text-error hover:bg-error-container rounded-md font-label text-label-sm font-semibold">Eliminar turno</button>`
                : `<span></span>`
            }
            <div class="flex items-center gap-2.5">
              <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md text-on-surface hover:bg-surface-container">
                Cancelar
              </button>
              <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold shadow-sm hover:opacity-95">
                ${isEdit ? 'Guardar Cambios' : 'Guardar Turno'}
              </button>
            </div>
          </div>
        </form>
      `);
    },
    openNewAppointmentModal(defaults = {}) {
      this.openAppointmentModal(null, defaults);
    },
    async submitAppointmentForm(e, aptId = '') {
      e.preventDefault();
      const form = e.target;
      const clientName = form.clientName.value.trim();
      const phone = form.phone.value.trim() || '+54 9 11 5555-0000';
      const serviceId = form.serviceId.value;
      const specialistId = form.specialistId.value;
      const date = form.date.value;
      const time = form.time.value;
      const status = form.status.value;
      const notes = form.notes.value.trim();

      const srv = state.services.find((s) => s.id === serviceId) || state.services[0];
      const sp = state.specialists.find((s) => s.id === specialistId) || state.specialists[0];
      const dayInfo = getDayInfoByDate(date);
      const rowBlock = mapTimeToRowBlock(time);

      // Find or create client
      let client = state.clients.find((c) => c.name.toLowerCase() === clientName.toLowerCase());
      if (!client) {
        client = {
          id: 'cli-' + Date.now(),
          initials: getInitials(clientName),
          name: clientName,
          email: clientName.toLowerCase().replace(/\s+/g, '.') + '@gmail.com',
          phone,
          phoneClean: phone.replace(/\D/g, ''),
          visits: 1,
          lastVisit: `${dayInfo.label} ${time}`,
          favoriteService: srv.shortName,
          since: 'Noviembre 2026',
          category: 'nuevo',
          isNew: true,
          totalSpent: srv.price,
          attendance: '100% puntual',
          avatarBg: 'bg-primary text-white',
          notes: notes ? [{ id: 'n-' + Date.now(), author: sp.shortName, date: '17 Nov 2026', text: notes }] : []
        };
        state.clients.unshift(client);
      } else if (!aptId) {
        client.visits += 1;
        client.lastVisit = `${dayInfo.label} ${time}`;
        client.totalSpent += srv.price;
      }

      if (aptId) {
        const existing = state.appointments.find((a) => a.id === aptId);
        if (existing) {
          existing.clientId = client.id;
          existing.clientName = client.name;
          existing.serviceId = srv.id;
          existing.serviceName = srv.name;
          existing.shortService = srv.shortName;
          existing.specialistId = sp.id;
          existing.specialistName = sp.name;
          existing.specialistShort = sp.shortName;
          existing.date = date;
          existing.dayCol = dayInfo.dayCol;
          existing.time = time;
          existing.rowBlock = rowBlock;
          existing.duration = srv.duration;
          existing.price = srv.price;
          existing.status = status;
          existing.notes = notes;
        }
        await persistState();
        closeModal();
        showToast(`Turno de ${client.name} actualizado (${dayInfo.shortLabel} ${time} hs).`);
      } else {
        const newApt = {
          id: 'apt-' + Date.now(),
          clientId: client.id,
          clientName: client.name,
          serviceId: srv.id,
          serviceName: srv.name,
          shortService: srv.shortName,
          specialistId: sp.id,
          specialistName: sp.name,
          specialistShort: sp.shortName,
          date,
          dayCol: dayInfo.dayCol,
          time,
          rowBlock,
          duration: srv.duration,
          price: srv.price,
          status,
          firstVisit: Boolean(client.isNew),
          notes
        };
        state.appointments.unshift(newApt);
        await persistState();
        closeModal();
        showToast(`Turno agendado para ${client.name} (${dayInfo.shortLabel} ${time} hs con ${sp.shortName}).`);
      }
      render();
    },

    // Calendar actions
    setCalendarSpecialist(specId) {
      ui.calendarSpecialist = specId;
      render();
    },
    setCalendarViewMode(mode, dateStr = null) {
      ui.calendarViewMode = mode;
      if (dateStr) ui.calendarSelectedDate = dateStr;
      render();
    },
    shiftCalendarWeek(delta) {
      if (ui.calendarViewMode === 'day') {
        const idx = ALL_DAYS.findIndex((d) => d.date === ui.calendarSelectedDate);
        const nextIdx = Math.max(0, Math.min(ALL_DAYS.length - 1, (idx === -1 ? 1 : idx) + delta));
        ui.calendarSelectedDate = ALL_DAYS[nextIdx].date;
      } else {
        ui.calendarWeekOffset += delta;
      }
      render();
    },
    openBlockScheduleModal(defaults = {}) {
      const defDate = defaults.date || '2026-11-18';
      const defRow = defaults.rowBlock || '09:00';
      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-warning font-semibold block">Control de Disponibilidad</span>
            <h3 class="font-display text-headline-lg italic text-white">Bloquear Horario en Agenda</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitBlockSchedule(event)" class="p-6 flex flex-col gap-4 text-body-sm">
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Motivo del bloqueo *</label>
            <input type="text" name="reason" required value="Desinfección de Cabina / Capacitación" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Día a bloquear</label>
              <select name="date" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
                ${ALL_DAYS.map((d) => `<option value="${d.date}" ${d.date === defDate ? 'selected' : ''}>${d.shortLabel}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Bloque horario</label>
              <select name="rowBlock" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
                <option value="09:00" ${defRow === '09:00' ? 'selected' : ''}>09:00 hs</option>
                <option value="10:30" ${defRow === '10:30' ? 'selected' : ''}>10:30 hs</option>
                <option value="11:15" ${defRow === '11:15' ? 'selected' : ''}>11:15 hs</option>
                <option value="14:00" ${defRow === '14:00' ? 'selected' : ''}>14:00 hs</option>
              </select>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Especialista</label>
              <select name="specialistId" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
                <option value="all">Todo el Atelier</option>
                ${state.specialists.map((sp) => `<option value="${sp.id}">${sp.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="p-3 rounded-md bg-surface-container-low border border-outline-variant text-[12px] text-on-surface-variant">
            También puedes modificar el horario fijo de almuerzo (${state.business.lunchBreak.start} a ${state.business.lunchBreak.end}) en la pestaña Servicios.
          </div>
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant">
            <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">Bloquear Franja</button>
          </div>
        </form>
      `);
    },
    async submitBlockSchedule(e) {
      e.preventDefault();
      const f = e.target;
      const date = f.date.value;
      const rowBlock = f.rowBlock.value;
      const specialistId = f.specialistId.value;
      const reason = f.reason.value.trim();
      const dayInfo = getDayInfoByDate(date);

      state.blockedSlots = state.blockedSlots || [];
      state.blockedSlots.push({
        id: 'blk-' + Date.now(),
        date,
        dayCol: dayInfo.dayCol,
        rowBlock,
        time: rowBlock,
        specialistId,
        reason
      });

      await persistState();
      closeModal();
      showToast(`Horario bloqueado: ${dayInfo.shortLabel} a las ${rowBlock} hs (${reason}).`);
      render();
    },
    async removeBlockedSlot(blockId) {
      state.blockedSlots = (state.blockedSlots || []).filter((b) => b.id !== blockId);
      await persistState();
      showToast('Bloqueo eliminado. El horario vuelve a estar disponible en la web.');
      render();
    },

    // CRM & Clients actions
    setClientFilter(filter) {
      ui.clientFilter = filter;
      ui.clientPage = 1;
      render();
    },
    setClientSearch(val) {
      ui.clientSearch = val;
      ui.clientPage = 1;
      render();
      const input = document.getElementById('crm-search-input');
      if (input) {
        input.focus();
        input.setSelectionRange(val.length, val.length);
      }
    },
    setClientPage(page) {
      ui.clientPage = page;
      render();
    },
    selectClient(clientId) {
      ui.selectedClientId = clientId;
      render();
    },
    openAddClientNoteModal(clientId) {
      const client = state.clients.find((c) => c.id === clientId);
      if (!client) return;
      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">Ficha Confidencial</span>
            <h3 class="font-display text-headline-lg italic text-white">Nueva Nota para ${client.name}</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitClientNote(event, '${client.id}')" class="p-6 flex flex-col gap-4 text-body-sm">
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Autor / Especialista</label>
            <select name="author" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
              ${state.specialists.map((sp) => `<option value="${sp.shortName} (${sp.role})">${sp.name} (${sp.role})</option>`).join('')}
              <option value="Recepción">Recepción</option>
            </select>
          </div>
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Observación clínica o de preferencia *</label>
            <textarea name="text" required rows="3" placeholder="Ej: Prefiere té verde sin azúcar, alérgica a fragancias sintéticas..." class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface"></textarea>
          </div>
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant">
            <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">Guardar Nota</button>
          </div>
        </form>
      `);
    },
    async submitClientNote(e, clientId) {
      e.preventDefault();
      const client = state.clients.find((c) => c.id === clientId);
      if (!client) return;
      const author = e.target.author.value;
      const text = e.target.text.value.trim();
      client.notes.unshift({
        id: 'n-' + Date.now(),
        author,
        date: '18 Nov 2026',
        text
      });
      await persistState();
      closeModal();
      showToast(`Nota confidencial añadida a la ficha de ${client.name}.`);
      render();
    },
    async deleteClientNote(clientId, noteIdx) {
      const client = state.clients.find((c) => c.id === clientId);
      if (!client) return;
      client.notes.splice(noteIdx, 1);
      await persistState();
      showToast('Nota eliminada de la ficha.');
      render();
    },
    openClientModal(clientId = null) {
      const existing = clientId ? state.clients.find((c) => c.id === clientId) : null;
      const isEdit = Boolean(existing);

      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">CRM VIP</span>
            <h3 class="font-display text-headline-lg italic text-white">${isEdit ? `Editar Ficha — ${existing.name}` : 'Registrar Nuevo Cliente'}</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitClientModal(event, '${existing ? existing.id : ''}')" class="p-6 flex flex-col gap-4 text-body-sm">
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Nombre y Apellido *</label>
            <input type="text" name="name" required value="${existing ? existing.name : ''}" placeholder="Ej: Julieta Nair" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">WhatsApp *</label>
              <input type="tel" name="phone" required value="${existing ? existing.phone : '+54 9 11 '}" placeholder="+54 9 11 4455-6677" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Email</label>
              <input type="email" name="email" value="${existing ? existing.email : ''}" placeholder="cliente@correo.com" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Servicio habitual</label>
              <select name="favoriteService" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
                ${state.services.map((s) => `<option value="${s.shortName}" ${existing && existing.favoriteService === s.shortName ? 'selected' : ''}>${s.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Categoría</label>
              <select name="category" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
                <option value="frecuente" ${existing && existing.category === 'frecuente' ? 'selected' : ''}>Cliente Frecuente VIP</option>
                <option value="nuevo" ${!existing || existing.category === 'nuevo' ? 'selected' : ''}>Nuevo ingreso</option>
              </select>
            </div>
          </div>
          ${
            !isEdit
              ? `
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Nota confidencial inicial (opcional)</label>
              <textarea name="note" rows="2" placeholder="Preferencias de bebida, alergias o comentarios..." class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface"></textarea>
            </div>
          `
              : ''
          }
          <div class="flex items-center justify-between pt-4 border-t border-outline-variant">
            ${
              isEdit
                ? `<button type="button" onclick="TurnosApp.deleteClient('${existing.id}')" class="px-3 py-2 border border-error/40 text-error hover:bg-error-container rounded-md font-label text-label-sm font-semibold">Eliminar ficha</button>`
                : `<span></span>`
            }
            <div class="flex items-center gap-2.5">
              <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
              <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">${isEdit ? 'Guardar Cambios' : 'Registrar Ficha'}</button>
            </div>
          </div>
        </form>
      `);
    },
    openNewClientModal() {
      this.openClientModal(null);
    },
    async submitClientModal(e, clientId = '') {
      e.preventDefault();
      const f = e.target;
      const name = f.name.value.trim();
      const phone = f.phone.value.trim();
      const email = f.email.value.trim() || name.toLowerCase().replace(/\s+/g, '.') + '@gmail.com';
      const favoriteService = f.favoriteService.value;
      const category = f.category.value;

      if (clientId) {
        const cli = state.clients.find((c) => c.id === clientId);
        if (cli) {
          cli.name = name;
          cli.initials = getInitials(name);
          cli.phone = phone;
          cli.phoneClean = phone.replace(/\D/g, '');
          cli.email = email;
          cli.favoriteService = favoriteService;
          cli.category = category;
          cli.isNew = category === 'nuevo';
        }
        await persistState();
        closeModal();
        showToast(`Ficha de ${name} actualizada.`);
      } else {
        const note = f.note ? f.note.value.trim() : '';
        const newClient = {
          id: 'cli-' + Date.now(),
          initials: getInitials(name),
          name,
          email,
          phone,
          phoneClean: phone.replace(/\D/g, ''),
          visits: 1,
          lastVisit: 'Recién registrado',
          favoriteService,
          since: 'Noviembre 2026',
          category,
          isNew: category === 'nuevo',
          totalSpent: 0,
          attendance: '100% puntual',
          avatarBg: 'bg-primary text-white',
          notes: note ? [{ id: 'n-' + Date.now(), author: 'Recepción', date: '18 Nov 2026', text: note }] : []
        };
        state.clients.unshift(newClient);
        ui.selectedClientId = newClient.id;
        await persistState();
        closeModal();
        showToast(`Cliente ${name} registrado en el directorio VIP.`);
      }
      render();
    },
    async deleteClient(clientId) {
      const idx = state.clients.findIndex((c) => c.id === clientId);
      if (idx !== -1) {
        const removed = state.clients.splice(idx, 1)[0];
        ui.selectedClientId = state.clients[0]?.id || '';
        await persistState();
        closeModal();
        showToast(`Ficha de ${removed.name} eliminada.`, 'warning');
        render();
      }
    },

    // Services & Policies actions
    openServiceModal(serviceId = null) {
      const srv = serviceId ? state.services.find((s) => s.id === serviceId) : null;
      const isEdit = Boolean(srv);
      const assignedSpecs = srv ? srv.specialists : ['sm', 'mc'];

      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">Catálogo Operativo</span>
            <h3 class="font-display text-headline-lg italic text-white">${isEdit ? 'Editar Servicio' : 'Crear Nuevo Servicio'}</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitServiceModal(event, '${srv ? srv.id : ''}')" class="p-6 flex flex-col gap-4 text-body-sm">
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Nombre del servicio *</label>
            <input type="text" name="name" required value="${srv ? srv.shortName : ''}" placeholder="Ej: Hidratación Facial Profunda" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
          </div>
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Descripción para clientes *</label>
            <input type="text" name="description" required value="${srv ? srv.description : ''}" placeholder="Ej: Limpieza ultrasónica y máscara descongestiva" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Duración (min)</label>
              <input type="number" name="duration" required min="15" step="5" value="${srv ? srv.duration : 45}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface font-semibold">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Buffer extra (min)</label>
              <input type="number" name="extraBuffer" required min="0" step="5" value="${srv ? srv.extraBuffer : 10}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface font-semibold">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Precio (ARS)</label>
              <input type="number" name="price" required min="1000" step="500" value="${srv ? srv.price : 20000}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface font-semibold">
            </div>
          </div>
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1.5">Especialistas habilitados para este servicio</label>
            <div class="flex items-center gap-4 flex-wrap bg-surface-container-low p-3 rounded-md border border-outline-variant">
              ${state.specialists
                .map(
                  (sp) => `
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="spec_${sp.id}" value="${sp.id}" ${assignedSpecs.includes(sp.id) ? 'checked' : ''} class="rounded text-primary focus:ring-primary">
                  <span class="font-medium text-on-surface">${sp.name}</span>
                </label>
              `
                )
                .join('')}
            </div>
          </div>
          <div class="flex items-center justify-between pt-4 border-t border-outline-variant">
            ${
              isEdit
                ? `<button type="button" onclick="TurnosApp.deleteService('${srv.id}')" class="px-3 py-2 border border-error/40 text-error hover:bg-error-container rounded-md font-label text-label-sm font-semibold">Eliminar</button>`
                : `<span></span>`
            }
            <div class="flex items-center gap-2.5">
              <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
              <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">${isEdit ? 'Guardar Cambios' : 'Agregar al Catálogo'}</button>
            </div>
          </div>
        </form>
      `);
    },
    async submitServiceModal(e, serviceId) {
      e.preventDefault();
      const f = e.target;
      const shortName = f.name.value.trim();
      const description = f.description.value.trim();
      const duration = Number(f.duration.value) || 45;
      const extraBuffer = Number(f.extraBuffer.value) || 10;
      const price = Number(f.price.value) || 20000;

      const selectedSpecs = state.specialists
        .filter((sp) => f[`spec_${sp.id}`] && f[`spec_${sp.id}`].checked)
        .map((sp) => sp.id);
      const specsFinal = selectedSpecs.length > 0 ? selectedSpecs : [state.specialists[0].id];

      if (serviceId) {
        const srv = state.services.find((s) => s.id === serviceId);
        if (srv) {
          srv.shortName = shortName;
          srv.name = shortName;
          srv.description = description;
          srv.publicDescription = description;
          srv.duration = duration;
          srv.extraBuffer = extraBuffer;
          srv.price = price;
          srv.publicPrice = price;
          srv.specialists = specsFinal;
        }
        showToast(`Servicio "${shortName}" actualizado.`);
      } else {
        state.services.push({
          id: 'srv-' + Date.now(),
          name: shortName,
          shortName,
          description,
          publicDescription: description,
          duration,
          extraBuffer,
          price,
          publicPrice: price,
          specialists: specsFinal,
          monthlyBookings: 15,
          monthlyRevenue: price * 15,
          active: true
        });
        showToast(`Nuevo servicio "${shortName}" habilitado en el catálogo web.`);
      }
      await persistState();
      closeModal();
      render();
    },
    async deleteService(serviceId) {
      const idx = state.services.findIndex((s) => s.id === serviceId);
      if (idx !== -1) {
        const removed = state.services.splice(idx, 1)[0];
        await persistState();
        closeModal();
        showToast(`Servicio "${removed.shortName}" eliminado del catálogo.`, 'warning');
        render();
      }
    },
    async toggleBufferRule() {
      const cycle = [10, 15, 20, 5];
      const idx = cycle.indexOf(state.business.bufferMinutes);
      state.business.bufferMinutes = cycle[(idx + 1) % cycle.length];
      await persistState();
      showToast(`Regla de limpieza actualizada a +${state.business.bufferMinutes} min entre turnos.`);
      render();
    },
    async toggleLunchDay(dayKey) {
      const days = state.business.lunchBreak.days;
      const idx = days.indexOf(dayKey);
      if (idx === -1) days.push(dayKey);
      else days.splice(idx, 1);
      await persistState();
      render();
    },
    async saveClientPolicies() {
      const minAdvEl = document.getElementById('policy-min-advance');
      const cancelEl = document.getElementById('policy-cancel-limit');
      const lunchStartEl = document.getElementById('lunch-start-input');
      const lunchEndEl = document.getElementById('lunch-end-input');
      if (minAdvEl) state.business.policies.minAdvance = minAdvEl.value;
      if (cancelEl) state.business.policies.cancelLimit = cancelEl.value;
      if (lunchStartEl) state.business.lunchBreak.start = lunchStartEl.value;
      if (lunchEndEl) state.business.lunchBreak.end = lunchEndEl.value;
      await persistState();
      showToast('Políticas de reserva y horarios de almuerzo guardados en el servidor.');
      render();
    },
    downloadCatalogPdf() {
      const printWin = window.open('', '_blank', 'width=800,height=700');
      if (!printWin) {
        this.exportAnalyticsReport();
        return;
      }
      printWin.document.write(`
        <html><head><title>Catálogo de Servicios — ${state.business.name}</title>
        <style>
          body { font-family: sans-serif; padding: 32px; color: #181721; }
          h1 { color: #442299; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border-bottom: 1px solid #ddd; padding: 12px 8px; text-align: left; }
          th { background: #F2EFF7; }
        </style></head><body>
          <h1>${state.business.name} — Catálogo Oficial de Servicios</h1>
          <p>${state.business.address} • Web: ${state.business.url}</p>
          <table>
            <thead><tr><th>Servicio</th><th>Descripción</th><th>Duración</th><th>Buffer</th><th>Precio</th></tr></thead>
            <tbody>
              ${state.services
                .map(
                  (s) =>
                    `<tr><td><strong>${s.name}</strong></td><td>${s.description}</td><td>${s.duration} min</td><td>+${s.extraBuffer} min</td><td><strong>${formatARS(s.price)}</strong></td></tr>`
                )
                .join('')}
            </tbody>
          </table>
          <script>window.onload = () => { window.print(); }</script>
        </body></html>
      `);
      printWin.document.close();
    },

    // Specialists CRUD actions
    openSpecialistModal(specId = null) {
      const sp = specId ? state.specialists.find((s) => s.id === specId) : null;
      const isEdit = Boolean(sp);

      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">Equipo &amp; Atelier</span>
            <h3 class="font-display text-headline-lg italic text-white">${isEdit ? `Editar Especialista — ${sp.name}` : 'Incorporar Especialista'}</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitSpecialistModal(event, '${sp ? sp.id : ''}')" class="p-6 flex flex-col gap-4 text-body-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Nombre completo *</label>
              <input type="text" name="name" required value="${sp ? sp.name : ''}" placeholder="Ej: Valeria Lynch" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Especialidad / Rol *</label>
              <input type="text" name="role" required value="${sp ? sp.role : ''}" placeholder="Ej: Colorista Senior" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Horario habitual</label>
              <input type="text" name="schedule" required value="${sp ? sp.schedule : 'Mar a Sáb • 10:00 a 19:00'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Comisión (%)</label>
              <input type="number" name="commission" required min="10" max="100" value="${sp ? sp.commission : 45}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface font-semibold">
            </div>
          </div>
          <div>
            <label class="font-label text-label-sm text-on-surface block mb-1">Estado en cabina hoy</label>
            <select name="status" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
              <option value="active" ${!sp || sp.status === 'active' ? 'selected' : ''}>En servicio (Activo)</option>
              <option value="warning" ${sp && sp.status === 'warning' ? 'selected' : ''}>Disponible próximo turno / En pausa</option>
            </select>
          </div>
          <div class="flex items-center justify-end gap-2.5 pt-4 border-t border-outline-variant">
            <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">${isEdit ? 'Guardar Cambios' : 'Agregar Especialista'}</button>
          </div>
        </form>
      `);
    },
    async submitSpecialistModal(e, specId = '') {
      e.preventDefault();
      const f = e.target;
      const name = f.name.value.trim();
      const role = f.role.value.trim();
      const schedule = f.schedule.value.trim();
      const commission = Number(f.commission.value) || 45;
      const status = f.status.value;
      const statusLabel = status === 'active' ? 'En servicio' : 'Disponible próximo turno';
      const parts = name.split(/\s+/);
      const shortName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : name;

      if (specId) {
        const sp = state.specialists.find((s) => s.id === specId);
        if (sp) {
          sp.name = name;
          sp.shortName = shortName;
          sp.initials = getInitials(name);
          sp.role = role;
          sp.schedule = schedule;
          sp.commission = commission;
          sp.status = status;
          sp.statusLabel = statusLabel;
        }
        showToast(`Datos de ${name} actualizados.`);
      } else {
        const newSp = {
          id: 'sp-' + Date.now(),
          initials: getInitials(name),
          name,
          shortName,
          role,
          avatarBg: 'bg-primary text-on-primary',
          status,
          statusLabel,
          appointmentsToday: 0,
          monthlyServices: 18,
          monthlyRevenue: 396000,
          rating: '5.0',
          reviews: 12,
          commission,
          schedule
        };
        state.specialists.push(newSp);
        showToast(`Especialista ${name} incorporado al equipo.`);
      }
      await persistState();
      closeModal();
      render();
    },

    // Reminders WhatsApp Bot actions
    updateWhatsAppTemplateInput(val) {
      state.business.whatsappBot.template24h = val;
      const previewEl = document.getElementById('wa-live-preview-text');
      if (previewEl) {
        previewEl.innerHTML = this.getFormattedReminderPreview();
      }
    },
    setReminderPreviewApt(aptId) {
      ui.reminderPreviewAptId = aptId;
      render();
    },
    getFormattedReminderPreview() {
      const apt = state.appointments.find((a) => a.id === ui.reminderPreviewAptId) || state.appointments[0];
      if (!apt) return '';
      const dayInfo = getDayInfoByDate(apt.date);
      return (state.business.whatsappBot.template24h || '')
        .replace('{{nombre}}', `<strong>${apt.clientName}</strong>`)
        .replace('{{servicio}}', `<strong>${apt.serviceName}</strong>`)
        .replace('{{especialista}}', `<strong>${apt.specialistName}</strong>`)
        .replace('{{fecha}}', `<strong>${dayInfo.shortLabel}</strong>`)
        .replace('{{hora}}', `<strong>${apt.time} hs</strong>`)
        .replace('{{direccion}}', state.business.address);
    },
    async saveWhatsAppTemplate() {
      const el = document.getElementById('wa-template-input');
      if (el) state.business.whatsappBot.template24h = el.value;
      await persistState();
      showToast('Plantilla de WhatsApp Concierge guardada.');
      render();
    },

    // Analytics actions
    setAnalyticsPeriod(period) {
      ui.analyticsPeriod = period;
      render();
    },
    exportAnalyticsReport() {
      // Download real CSV from backend API or client-side Blob fallback
      const a = document.createElement('a');
      a.href = '/api/export/csv';
      a.download = 'StudioBellas_Turnos_Nov2026.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Descargando archivo StudioBellas_Turnos_Nov2026.csv...');
    },

    // Plans & Billing actions
    async selectPlan(planTier) {
      state.business.plan = planTier;
      await persistState();
      const names = { FREE: 'Plan Free ($0/mes)', PRO: 'Plan Pro ($29.900/mes)', BUSINESS: 'Plan Business ($58.000/mes)' };
      showToast(`Suscripción actualizada a ${names[planTier]}.`);
      render();
    },
    openInvoicesModal() {
      const invoices = state.business.invoices || [];
      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">Roble Studio SaaS</span>
            <h3 class="font-display text-headline-lg italic text-white">Recibos &amp; Facturas Emitidas</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <div class="p-6 flex flex-col gap-3 text-body-sm">
          ${invoices
            .map(
              (inv) => `
            <div class="flex items-center justify-between p-3.5 rounded-md border border-outline-variant bg-surface-container-low">
              <div>
                <p class="font-semibold text-on-surface">Factura #${inv.id} • ${inv.period}</p>
                <p class="text-on-surface-variant text-[12px]">Emitida el ${inv.date} • ${state.business.paymentMethod.brand} •••• ${state.business.paymentMethod.last4}</p>
              </div>
              <div class="flex items-center gap-3">
                <div class="text-right">
                  <span class="font-bold text-on-surface block">${formatARS(inv.amount)}</span>
                  <span class="text-success text-[11px] font-semibold">${inv.status}</span>
                </div>
                <button type="button" onclick="TurnosApp.downloadInvoice('${inv.id}')" class="p-2 rounded border border-outline bg-surface hover:bg-surface-container text-primary" title="Descargar comprobante">
                  <span class="material-symbols-outlined text-body-md">download</span>
                </button>
              </div>
            </div>
          `
            )
            .join('')}
          <div class="flex justify-end pt-3 border-t border-outline-variant">
            <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">Cerrar</button>
          </div>
        </div>
      `);
    },
    downloadInvoice(invId) {
      showToast(`Comprobante fiscal #${invId}.pdf descargado.`);
    },
    openPaymentMethodModal() {
      const pm = state.business.paymentMethod || {};
      openModal(`
        <div class="bg-brand-roble text-white px-6 py-4 flex items-center justify-between">
          <div>
            <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold block">Facturación Automática</span>
            <h3 class="font-display text-headline-lg italic text-white">Administrar Método de Pago</h3>
          </div>
          <button type="button" onclick="TurnosApp.closeModal()" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-title-lg">close</span>
          </button>
        </div>
        <form onsubmit="TurnosApp.submitPaymentMethod(event)" class="p-6 flex flex-col gap-4 text-body-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Tarjeta / Medio</label>
              <input type="text" name="brand" required value="${pm.brand || 'Visa Corporativa'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Últimos 4 dígitos</label>
              <input type="text" name="last4" required maxlength="4" value="${pm.last4 || '4821'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface font-semibold">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Titular en tarjeta</label>
              <input type="text" name="holder" required value="${pm.holder || 'CAMILA LOPEZ'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Vencimiento (MM/AA)</label>
              <input type="text" name="expiry" required value="${pm.expiry || '08/29'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">Email de facturación</label>
              <input type="email" name="billingEmail" required value="${pm.billingEmail || 'admin@studiobellas.com'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
            <div>
              <label class="font-label text-label-sm text-on-surface block mb-1">CUIT Razón Social</label>
              <input type="text" name="cuit" required value="${pm.cuit || '30-71548921-9'}" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface">
            </div>
          </div>
          <div class="flex items-center justify-end gap-2.5 pt-4 border-t border-outline-variant">
            <button type="button" onclick="TurnosApp.closeModal()" class="px-4 py-2 border border-outline rounded-md font-label text-label-md">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold">Guardar Medio de Pago</button>
          </div>
        </form>
      `);
    },
    async submitPaymentMethod(e) {
      e.preventDefault();
      const f = e.target;
      state.business.paymentMethod = {
        brand: f.brand.value.trim(),
        last4: f.last4.value.trim(),
        holder: f.holder.value.trim(),
        expiry: f.expiry.value.trim(),
        billingEmail: f.billingEmail.value.trim(),
        cuit: f.cuit.value.trim()
      };
      await persistState();
      closeModal();
      showToast(`Método de pago actualizado (${state.business.paymentMethod.brand} •••• ${state.business.paymentMethod.last4}).`);
      render();
    },

    // Public Booking Flow actions
    selectPublicService(serviceId) {
      ui.publicBooking.serviceId = serviceId;
      ui.publicBooking.confirmedReceipt = null;
      render();
    },
    selectPublicSpecialist(specId) {
      ui.publicBooking.specialistId = specId;
      ui.publicBooking.confirmedReceipt = null;
      render();
    },
    selectPublicDay(dayIdx) {
      ui.publicBooking.dayIndex = dayIdx;
      ui.publicBooking.confirmedReceipt = null;
      render();
    },
    selectPublicTime(timeStr) {
      ui.publicBooking.time = timeStr;
      ui.publicBooking.confirmedReceipt = null;
      render();
    },
    updatePublicField(field, value) {
      ui.publicBooking[field] = value;
    },
    async confirmPublicBooking() {
      const pb = ui.publicBooking;
      const name = (pb.clientName || '').trim();
      const phone = (pb.clientPhone || '').trim();
      if (!name || !phone) {
        showToast('Por favor completa tu nombre y WhatsApp para confirmar.', 'warning');
        return;
      }
      const srv = state.services.find((s) => s.id === pb.serviceId) || state.services[0];
      const dayObj = PUBLIC_DAYS[pb.dayIndex] || PUBLIC_DAYS[0];

      // Pick specialist (avoiding double-booking if 'any' was chosen)
      let sp = state.specialists[0];
      if (pb.specialistId !== 'any') {
        sp = state.specialists.find((s) => s.id === pb.specialistId) || state.specialists[0];
      } else {
        const availableSp = state.specialists.find(
          (s) => !isSlotOccupied(dayObj.date, pb.time, s.id)
        );
        sp = availableSp || state.specialists[0];
      }

      if (isSlotOccupied(dayObj.date, pb.time, sp.id)) {
        showToast('Ese horario acaba de ocuparse. Por favor selecciona otra hora disponible.', 'warning');
        return;
      }

      const finalPrice = srv.publicPrice || srv.price;

      // Add/update client in CRM
      let client = state.clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!client) {
        client = {
          id: 'cli-' + Date.now(),
          initials: getInitials(name),
          name,
          email: name.toLowerCase().replace(/\s+/g, '.') + '@gmail.com',
          phone,
          phoneClean: phone.replace(/\D/g, ''),
          visits: 1,
          lastVisit: `${dayObj.label} ${pb.time}`,
          favoriteService: srv.shortName,
          since: 'Noviembre 2026',
          category: 'nuevo',
          isNew: true,
          totalSpent: finalPrice,
          attendance: 'Primera visita',
          avatarBg: 'bg-primary text-white',
          notes: [
            {
              id: 'n-' + Date.now(),
              author: 'Reserva Web Online',
              date: '18 Nov 2026',
              text: `Reserva creada desde ${state.business.url} para ${srv.shortName} (${dayObj.shortLabel} a las ${pb.time} hs).`
            }
          ]
        };
        state.clients.unshift(client);
      } else {
        client.visits += 1;
        client.lastVisit = `${dayObj.label} ${pb.time}`;
        client.totalSpent += finalPrice;
      }

      const newApt = {
        id: 'apt-' + Date.now(),
        clientId: client.id,
        clientName: client.name,
        serviceId: srv.id,
        serviceName: srv.name,
        shortService: srv.shortName,
        specialistId: sp.id,
        specialistName: sp.name,
        specialistShort: sp.shortName,
        date: dayObj.date,
        dayCol: dayObj.dayCol,
        time: pb.time,
        rowBlock: mapTimeToRowBlock(pb.time),
        duration: srv.duration,
        price: finalPrice,
        status: 'confirmed',
        firstVisit: Boolean(client.isNew),
        notes: 'Reserva confirmada desde Web Pública'
      };

      state.appointments.unshift(newApt);
      state.business.whatsappBot.sentToday += 1;
      state.business.whatsappBot.logs.unshift({
        id: 'log-' + Date.now(),
        time: new Date().toTimeString().slice(0, 5),
        clientName: client.name,
        phone,
        service: srv.shortName,
        status: 'Comprobante de reserva online enviado'
      });

      await persistState();

      ui.publicBooking.confirmedReceipt = {
        aptId: newApt.id,
        code: 'SB-' + Math.floor(1000 + Math.random() * 9000),
        clientName: client.name,
        phone,
        phoneClean: phone.replace(/\D/g, ''),
        serviceName: srv.name,
        specialistName: sp.name,
        dayLabel: dayObj.shortLabel,
        date: dayObj.date,
        time: pb.time,
        price: finalPrice,
        duration: srv.duration
      };

      showToast(`¡Cita confirmada para ${client.name}! Guardada en la base de datos.`);
      render();
    },
    resetPublicBooking() {
      ui.publicBooking.confirmedReceipt = null;
      render();
    },
    closeModal
  };

  document.addEventListener('click', () => {
    if (ui.activeMenuAptId) {
      ui.activeMenuAptId = null;
      render();
    }
  });

  // Render Sidebar
  function renderSidebar() {
    const pendingTotal = state.appointments.filter((a) => a.status === 'pending').length;
    const navItems = [
      { id: 'dashboard', icon: 'dashboard', label: 'Vista General', badge: pendingTotal > 0 ? pendingTotal : null },
      { id: 'calendar', icon: 'calendar_today', label: 'Agenda Selecta' },
      { id: 'clients', icon: 'person_search', label: 'Clientes VIP' },
      { id: 'services', icon: 'spa', label: 'Servicios' },
      { id: 'specialists', icon: 'badge', label: 'Especialistas' },
      { id: 'reminders', icon: 'send', label: 'Recordatorios' },
      { id: 'analytics', icon: 'finance_chip', label: 'Rendimiento' },
      { id: 'plans', icon: 'workspace_premium', label: 'Planes & Facturación' }
    ];

    const planBadge =
      state.business.plan === 'BUSINESS'
        ? 'Business • Roble'
        : state.business.plan === 'FREE'
        ? 'Free • Roble'
        : 'Concierge Pro • Roble';

    return `
      <aside class="w-64 bg-brand-roble text-white flex flex-col justify-between p-5 sticky top-0 h-screen shrink-0 border-r border-outline-variant select-none">
        <div class="flex flex-col gap-8">
          <div class="flex items-center gap-3 px-1 cursor-pointer" onclick="TurnosApp.setTab('dashboard')">
            <div class="w-9 h-9 rounded-md bg-primary text-on-primary flex items-center justify-center font-display font-bold text-headline-lg shadow-sm">
              T
            </div>
            <div class="flex flex-col">
              <span class="font-display font-semibold text-headline-lg tracking-wide text-white leading-none">${state.business.name}</span>
              <span class="font-label text-label-sm text-outline-variant flex items-center gap-1.5 mt-1">
                <span class="w-1.5 h-1.5 rounded-full bg-accent inline-block"></span> ${planBadge}
              </span>
            </div>
          </div>

          <nav class="flex flex-col gap-1.5">
            ${navItems
              .map((item) => {
                const isActive = ui.tab === item.id;
                const activeClasses = isActive
                  ? 'bg-primary-container/20 text-white border-l-2 border-accent'
                  : 'text-outline hover:bg-surface-container/20 hover:text-white';
                const iconClass = isActive ? 'text-accent' : '';
                return `
                  <a href="#${item.id}" onclick="event.preventDefault(); TurnosApp.setTab('${item.id}')" class="flex items-center justify-between px-3.5 py-2.5 rounded-md font-label text-label-lg transition-all duration-state-change ${activeClasses}">
                    <div class="flex items-center gap-3">
                      <span class="material-symbols-outlined text-title-lg ${iconClass}">${item.icon}</span>
                      <span>${item.label}</span>
                    </div>
                    ${
                      item.badge
                        ? `<span class="px-1.5 py-0.5 text-[10px] rounded-full bg-warning text-white font-bold">${item.badge}</span>`
                        : ''
                    }
                  </a>
                `;
              })
              .join('')}
          </nav>
        </div>

        <div class="flex flex-col gap-4 pt-5 border-t border-outline-variant">
          <div class="bg-primary/20 p-3.5 rounded-md border border-primary/40 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-sm text-outline">Enlace del Negocio</span>
              <span class="material-symbols-outlined text-body-sm text-accent">diamond</span>
            </div>
            <div class="text-body-sm text-white font-medium truncate cursor-pointer hover:underline" onclick="TurnosApp.setMode('public')" title="Abrir vista pública de reservas">
              ${state.business.url}
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" onclick="TurnosApp.copyBusinessLink()" class="w-full text-center py-1.5 bg-surface text-primary rounded-sm text-label-sm font-semibold hover:bg-accent hover:text-brand-roble transition-all duration-state-change">
                Copiar link
              </button>
              <button type="button" onclick="TurnosApp.setMode('public')" class="w-full text-center py-1.5 bg-primary text-white rounded-sm text-label-sm font-semibold hover:bg-accent hover:text-brand-roble transition-all duration-state-change flex items-center justify-center gap-1">
                <span>Abrir Web</span>
                <span class="material-symbols-outlined text-[13px]">open_in_new</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between px-1">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-full bg-secondary text-on-secondary font-display font-semibold flex items-center justify-center text-label-md">
                ${state.business.ownerInitials}
              </div>
              <div class="flex flex-col">
                <span class="font-headline text-label-md text-white">${state.business.owner}</span>
                <span class="font-body text-body-sm text-outline">${state.business.ownerRole}</span>
              </div>
            </div>
            <button type="button" onclick="TurnosApp.resetDemoData()" class="text-outline hover:text-white" title="Restaurar base de datos demo" aria-label="Restaurar demo">
              <span class="material-symbols-outlined text-title-lg">restart_alt</span>
            </button>
          </div>
        </div>
      </aside>
    `;
  }

  // SCREEN 1: Panel Principal — Admin TurnosApp (Vista General)
  function renderDashboardView() {
    const activeDayInfo = getDayInfoByDate(ui.dashboardDate);
    const dayApts = state.appointments
      .filter((a) => a.date === ui.dashboardDate)
      .sort((a, b) => a.time.localeCompare(b.time));

    const confirmedCount = dayApts.filter((a) => a.status === 'confirmed' || a.status === 'completed').length;
    const pendingCount = dayApts.filter((a) => a.status === 'pending').length;
    const baselineEarlier = ui.dashboardDate === '2026-11-17' ? 12 : 10;
    const totalCount = dayApts.length + baselineEarlier;

    const filteredApts = dayApts.filter((a) => {
      if (ui.dashboardFilter === 'confirmed') return a.status === 'confirmed' || a.status === 'completed';
      if (ui.dashboardFilter === 'pending') return a.status === 'pending';
      return true;
    });

    const dayRevenue = dayApts.reduce((acc, a) => acc + (a.price || 0), 0);
    const projectedRevenue = (ui.dashboardDate === '2026-11-17' ? 165300 : 140000) + dayRevenue;
    const totalMinutes = dayApts.reduce((acc, a) => acc + (a.duration || 45), 0) + 210;
    const occupancyPct = Math.min(98, Math.round((totalMinutes / 480) * 100));
    const effectiveHours = (totalMinutes / 60).toFixed(1);

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Bitácora Operativa</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Control &amp; Agenda Exclusiva</h1>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <!-- Interactive Date Selector -->
          <div class="flex items-center gap-1 bg-surface-container px-2 py-1.5 rounded-md border border-outline-variant text-body-sm text-on-surface">
            <button type="button" onclick="TurnosApp.shiftDashboardDate(-1)" class="p-1 rounded hover:bg-surface text-on-surface-variant hover:text-primary" title="Día anterior">
              <span class="material-symbols-outlined text-body-md">chevron_left</span>
            </button>
            <div class="flex items-center gap-1.5 px-2">
              <span class="material-symbols-outlined text-title-md text-primary">calendar_month</span>
              <select onchange="TurnosApp.setDashboardDate(this.value)" class="bg-transparent border-none p-0 pr-5 font-medium text-body-sm text-on-surface focus:ring-0 cursor-pointer">
                ${ALL_DAYS.map(
                  (d) => `<option value="${d.date}" ${d.date === ui.dashboardDate ? 'selected' : ''}>${d.fullLabel}</option>`
                ).join('')}
              </select>
            </div>
            <button type="button" onclick="TurnosApp.shiftDashboardDate(1)" class="p-1 rounded hover:bg-surface text-on-surface-variant hover:text-primary" title="Día siguiente">
              <span class="material-symbols-outlined text-body-md">chevron_right</span>
            </button>
          </div>

          <button type="button" onclick="TurnosApp.openNewAppointmentModal({ date: '${ui.dashboardDate}' })" class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-md font-label text-label-lg shadow-sm hover:opacity-95 active:scale-95 transition-all duration-state-change whitespace-nowrap">
            <span class="material-symbols-outlined text-title-lg text-white">add</span>
            <span>Agendar nueva cita</span>
          </button>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <!-- Top Metrics Cards -->
        <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Citas Confirmadas</span>
              <span class="material-symbols-outlined text-title-lg text-primary">schedule</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${totalCount} <span class="text-title-lg font-normal text-on-surface-variant font-body">turnos</span></h2>
              <div class="flex items-center justify-between mt-2 pt-2 border-t border-outline-variant text-body-sm text-on-surface-variant">
                <span>${baselineEarlier} concluidas</span>
                <span class="text-warning font-semibold">${dayApts.length} en curso / hoy</span>
              </div>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Facturación Proyectada</span>
              <span class="material-symbols-outlined text-title-lg text-primary">account_balance_wallet</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${formatARS(projectedRevenue)}</h2>
              <div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-outline-variant text-body-sm text-success">
                <span class="material-symbols-outlined text-label-sm">trending_up</span>
                <span class="font-medium">+18.4%</span> semanal
              </div>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Ocupación de Cabinas</span>
              <span class="material-symbols-outlined text-title-lg text-secondary">donut_large</span>
            </div>
            <div class="mt-4">
              <div class="flex items-center justify-between">
                <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${occupancyPct}%</h2>
                <span class="text-body-sm text-on-surface-variant">${effectiveHours}h efectivas</span>
              </div>
              <div class="w-full bg-surface-container rounded-full h-1.5 mt-3 overflow-hidden">
                <div class="bg-primary h-1.5 rounded-full transition-all duration-300" style="width: ${occupancyPct}%"></div>
              </div>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Fidelización</span>
              <span class="material-symbols-outlined text-title-lg text-primary">hotel_class</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${422 + state.clients.length} <span class="text-title-lg font-normal text-on-surface-variant font-body">socios</span></h2>
              <div class="flex items-center justify-between mt-2 pt-2 border-t border-outline-variant text-body-sm">
                <span class="text-on-surface-variant">${state.clients.filter((c) => c.isNew).length + 23} nuevas este mes</span>
                <span class="text-success font-semibold flex items-center gap-1">
                  <span class="material-symbols-outlined text-label-sm">verified</span> 0% ausencias
                </span>
              </div>
            </div>
          </article>
        </section>

        <!-- Main Agenda & Team Panels -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Left 2 Cols: Agenda de Citas -->
          <section class="lg:col-span-2 bg-surface rounded-lg border border-outline-variant p-7 shadow-sm flex flex-col gap-6">
            <div class="flex items-center justify-between flex-wrap gap-4 border-b border-outline-variant pb-5">
              <div>
                <h3 class="font-display text-headline-lg text-on-surface font-semibold">Cronograma del Día (${activeDayInfo.shortLabel})</h3>
                <p class="font-body text-body-sm text-on-surface-variant mt-0.5">Control en tiempo real de profesionales, servicios y tiempos entre sesiones</p>
              </div>

              <!-- Filter tabs -->
              <div class="flex items-center gap-1 bg-surface-container p-1 rounded-md shrink-0">
                <button type="button" onclick="TurnosApp.setDashboardFilter('all')" class="px-3.5 py-1.5 rounded text-label-sm whitespace-nowrap transition-all ${
                  ui.dashboardFilter === 'all'
                    ? 'bg-surface font-semibold text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }">Todas (${dayApts.length})</button>
                <button type="button" onclick="TurnosApp.setDashboardFilter('confirmed')" class="px-3.5 py-1.5 rounded text-label-sm whitespace-nowrap transition-all ${
                  ui.dashboardFilter === 'confirmed'
                    ? 'bg-surface font-semibold text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }">Confirmadas (${confirmedCount})</button>
                <button type="button" onclick="TurnosApp.setDashboardFilter('pending')" class="px-3.5 py-1.5 rounded text-label-sm whitespace-nowrap transition-all ${
                  ui.dashboardFilter === 'pending'
                    ? 'bg-surface font-semibold text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }">Por aprobar (${pendingCount})</button>
              </div>
            </div>

            <!-- List of curated bookings -->
            <div class="flex flex-col gap-3.5">
              ${
                filteredApts.length === 0
                  ? `<div class="p-8 text-center text-on-surface-variant border border-dashed border-outline-variant rounded-md flex flex-col items-center gap-2">
                      <p>No hay citas en este filtro para ${activeDayInfo.shortLabel}.</p>
                      <button type="button" onclick="TurnosApp.openNewAppointmentModal({ date: '${ui.dashboardDate}' })" class="px-3.5 py-1.5 bg-primary text-white rounded text-label-sm font-semibold">+ Agendar turno en este día</button>
                    </div>`
                  : filteredApts
                      .map((apt, idx) => {
                        const isPending = apt.status === 'pending';
                        const isCompleted = apt.status === 'completed';

                        if (isPending) {
                          return `
                            <div class="flex items-center justify-between p-4 rounded-md border border-warning/40 bg-warning-container/20 hover:border-warning transition-all duration-state-change flex-wrap gap-3">
                              <div class="flex items-center gap-4 cursor-pointer" onclick="TurnosApp.openAppointmentModal('${apt.id}')">
                                <div class="flex flex-col items-center justify-center w-16 py-1.5 rounded bg-warning-container text-on-warning-container font-body font-bold">
                                  <span class="text-title-md tabular-nums">${apt.time}</span>
                                  <span class="text-[10px] font-medium">${apt.duration} min</span>
                                </div>
                                <div class="min-w-0">
                                  <div class="flex items-center gap-2">
                                    <h4 class="font-body text-title-md text-on-surface font-semibold truncate">${apt.clientName}</h4>
                                    ${
                                      apt.firstVisit
                                        ? `<span class="text-label-sm font-semibold bg-surface px-2 py-0.5 rounded border border-outline-variant text-primary whitespace-nowrap">Primera Visita</span>`
                                        : ''
                                    }
                                  </div>
                                  <p class="font-body text-body-sm text-on-surface-variant flex items-center gap-2 mt-0.5 truncate">
                                    <span class="text-on-surface font-medium">${apt.serviceName}</span>
                                    <span>•</span>
                                    <span class="text-primary font-medium">${apt.specialistName}</span>
                                  </p>
                                </div>
                              </div>
                              <div class="flex items-center gap-3">
                                <span class="font-body text-title-md font-bold text-on-surface tabular-nums">${formatARS(apt.price)}</span>
                                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-container text-on-warning-container font-label text-label-sm font-semibold whitespace-nowrap">
                                  <span class="w-1.5 h-1.5 rounded-full bg-warning"></span> Pendiente
                                </span>
                                <div class="flex items-center gap-1.5">
                                  <button type="button" onclick="TurnosApp.approveAppointment('${apt.id}')" class="px-3 py-1 bg-primary text-on-primary rounded text-label-sm font-semibold hover:opacity-90">Aprobar</button>
                                  <button type="button" onclick="TurnosApp.discardAppointment('${apt.id}')" class="px-3 py-1 bg-surface border border-outline text-error rounded text-label-sm font-semibold hover:bg-error-container">Descartar</button>
                                </div>
                              </div>
                            </div>
                          `;
                        }

                        const timeBadgeClass =
                          idx === 0
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container text-on-surface';

                        return `
                          <div class="relative flex items-center justify-between p-4 rounded-md border border-outline-variant ${
                            idx === 0 ? 'bg-surface-container-low' : 'bg-surface'
                          } hover:border-primary transition-all duration-state-change flex-wrap gap-3">
                            <div class="flex items-center gap-4 cursor-pointer" onclick="TurnosApp.openAppointmentModal('${apt.id}')" title="Clic para editar turno">
                              <div class="flex flex-col items-center justify-center w-16 py-1.5 rounded ${timeBadgeClass} font-body font-bold border border-outline-variant">
                                <span class="text-title-md tabular-nums">${apt.time}</span>
                                <span class="text-[10px] text-on-surface-variant font-medium">${apt.duration} min</span>
                              </div>
                              <div>
                                <div class="flex items-center gap-2">
                                  <h4 class="font-body text-title-md text-on-surface font-semibold hover:text-primary">${apt.clientName}</h4>
                                  ${apt.notes ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant" title="${apt.notes}">Nota</span>` : ''}
                                </div>
                                <p class="font-body text-body-sm text-on-surface-variant flex items-center gap-2 mt-0.5">
                                  <span class="text-on-surface font-medium">${apt.serviceName}</span>
                                  <span>•</span>
                                  <span class="text-primary font-medium">${apt.specialistName}</span>
                                </p>
                              </div>
                            </div>
                            <div class="flex items-center gap-4">
                              <span class="font-body text-title-md font-bold text-on-surface tabular-nums">${formatARS(apt.price)}</span>
                              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${
                                isCompleted ? 'bg-primary-container text-on-primary-container' : 'bg-success-container text-on-success-container'
                              } font-label text-label-sm font-semibold whitespace-nowrap">
                                <span class="w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-primary' : 'bg-success'}"></span>
                                ${isCompleted ? 'Concluido' : 'Confirmado'}
                              </span>
                              <div class="relative">
                                <button type="button" onclick="TurnosApp.toggleAptMenu('${apt.id}', event)" class="p-1.5 text-on-surface-variant hover:text-primary rounded-full hover:bg-surface-variant" aria-label="Opciones del turno">
                                  <span class="material-symbols-outlined text-title-lg">more_horiz</span>
                                </button>
                                ${
                                  ui.activeMenuAptId === apt.id
                                    ? `
                                  <div class="absolute right-0 mt-1 w-56 bg-surface rounded-md shadow-xl border border-outline-variant py-1 z-30 text-body-sm">
                                    <button type="button" onclick="TurnosApp.openAppointmentModal('${apt.id}')" class="w-full text-left px-3.5 py-2 hover:bg-surface-container flex items-center gap-2 text-on-surface">
                                      <span class="material-symbols-outlined text-body-md text-primary">edit_calendar</span>
                                      Editar / Reprogramar
                                    </button>
                                    <button type="button" onclick="TurnosApp.completeAppointment('${apt.id}')" class="w-full text-left px-3.5 py-2 hover:bg-surface-container flex items-center gap-2 text-on-surface">
                                      <span class="material-symbols-outlined text-body-md text-success">task_alt</span>
                                      Marcar como Concluido
                                    </button>
                                    <button type="button" onclick="TurnosApp.sendWhatsAppReminder('${apt.id}')" class="w-full text-left px-3.5 py-2 hover:bg-surface-container flex items-center gap-2 text-on-surface">
                                      <span class="material-symbols-outlined text-body-md text-success">chat</span>
                                      Enviar recordatorio Bot
                                    </button>
                                    <button type="button" onclick="TurnosApp.viewClientFromApt('${apt.id}')" class="w-full text-left px-3.5 py-2 hover:bg-surface-container flex items-center gap-2 text-on-surface">
                                      <span class="material-symbols-outlined text-body-md text-primary">person_search</span>
                                      Ver ficha en CRM
                                    </button>
                                    <button type="button" onclick="TurnosApp.discardAppointment('${apt.id}')" class="w-full text-left px-3.5 py-2 hover:bg-error-container flex items-center gap-2 text-error border-t border-outline-variant">
                                      <span class="material-symbols-outlined text-body-md">cancel</span>
                                      Cancelar turno
                                    </button>
                                  </div>
                                `
                                    : ''
                                }
                              </div>
                            </div>
                          </div>
                        `;
                      })
                      .join('')
              }
            </div>

            <!-- Footer link -->
            <div class="pt-4 border-t border-outline-variant flex items-center justify-between">
              <span class="text-body-sm text-on-surface-variant">Mostrando ${filteredApts.length} turnos de ${activeDayInfo.shortLabel} (clic en un turno para editarlo)</span>
              <a href="#calendar" onclick="event.preventDefault(); TurnosApp.setTab('calendar')" class="text-label-md font-label text-primary hover:text-secondary font-semibold flex items-center gap-1 transition-all duration-state-change">
                Explorar vista mensual y calendario
                <span class="material-symbols-outlined text-title-md">arrow_forward</span>
              </a>
            </div>
          </section>

          <!-- Right Col: Profesionales & WhatsApp Bot -->
          <div class="flex flex-col gap-6">
            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <h3 class="font-display text-headline-lg text-on-surface font-semibold">Especialistas</h3>
                <button type="button" onclick="TurnosApp.openSpecialistModal()" class="text-label-sm text-primary font-semibold hover:underline">+ Gestionar (${state.specialists.length})</button>
              </div>

              <div class="flex flex-col gap-3">
                ${state.specialists
                  .map((sp) => {
                    const countForDay = state.appointments.filter(
                      (a) => a.date === ui.dashboardDate && a.specialistId === sp.id
                    ).length + (ui.dashboardDate === '2026-11-17' ? 4 : 2);
                    return `
                      <div onclick="TurnosApp.openSpecialistModal('${sp.id}')" class="flex items-center justify-between p-3 rounded-md bg-surface-container-low border border-outline-variant cursor-pointer hover:border-primary/50 transition-all" title="Clic para editar especialista">
                        <div class="flex items-center gap-3">
                          <div class="w-9 h-9 rounded-full ${sp.avatarBg} font-display font-bold flex items-center justify-center text-label-md">
                            ${sp.initials}
                          </div>
                          <div>
                            <p class="font-body text-label-lg font-semibold text-on-surface">${sp.name}</p>
                            <p class="text-body-sm text-on-surface-variant">${sp.role} • ${countForDay} citas hoy</p>
                          </div>
                        </div>
                        <span class="w-2.5 h-2.5 rounded-full ${sp.status === 'active' ? 'bg-success' : 'bg-warning'}" title="${sp.statusLabel}"></span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </section>

            <!-- Concierge WhatsApp & Recordatorios -->
            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-md bg-primary-container text-on-primary-container flex items-center justify-center">
                    <span class="material-symbols-outlined text-title-md">forum</span>
                  </div>
                  <h3 class="font-display text-headline-lg text-on-surface font-semibold">WhatsApp Bot</h3>
                </div>
                <span class="text-label-sm bg-success-container text-on-success-container px-2.5 py-0.5 rounded-full font-semibold">Conectado</span>
              </div>
              <p class="text-body-sm text-on-surface-variant">
                Recordatorios y confirmaciones personalizadas 24 horas antes con confirmación directa con un toque.
              </p>

              <div class="flex flex-col gap-2.5 pt-2 text-body-sm">
                <div class="flex items-center justify-between py-1 border-b border-outline-variant">
                  <span class="text-on-surface-variant">Mensajes enviados hoy</span>
                  <span class="font-bold text-on-surface tabular-nums">${state.business.whatsappBot.sentToday} confirmaciones</span>
                </div>
                <div class="flex items-center justify-between py-1">
                  <span class="text-on-surface-variant">Efectividad de asistencia</span>
                  <span class="font-bold text-success tabular-nums">${state.business.whatsappBot.attendanceRate}</span>
                </div>
              </div>

              <button type="button" onclick="TurnosApp.setTab('reminders')" class="w-full py-2.5 bg-surface-container text-on-surface hover:bg-surface-variant rounded-md text-label-sm font-semibold transition-all duration-state-change border border-outline-variant">
                Gestionar mensajes y políticas
              </button>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  // SCREEN 5: Agenda Semanal, Diaria & Mensual (100% Funcional)
  function renderCalendarView() {
    const daysHeader = ALL_DAYS.map((d) => {
      const realCount =
        state.appointments.filter(
          (a) =>
            a.date === d.date &&
            (ui.calendarSpecialist === 'all' || a.specialistId === ui.calendarSpecialist)
        ).length + 10;
      return {
        ...d,
        numDisplay: Number(d.num) + ui.calendarWeekOffset * 7,
        countLabel: d.isSat ? 'Completo' : `${realCount} turnos`
      };
    });

    const timeBlocks = [
      { key: '09:00', defaultLabel: '09:00' },
      { key: '10:30', defaultLabel: '10:30' },
      { key: '11:15', defaultLabel: '11:15' },
      { key: 'LUNCH' },
      { key: '14:00', defaultLabel: '14:00' }
    ];

    function renderWeekCell(day, rowBlockKey) {
      const borderClass = day.dayCol < 5 ? 'border-r border-outline-variant/60' : '';

      // Check if manually blocked
      const blockObj = (state.blockedSlots || []).find(
        (b) =>
          b.date === day.date &&
          b.rowBlock === rowBlockKey &&
          (b.specialistId === 'all' || ui.calendarSpecialist === 'all' || b.specialistId === ui.calendarSpecialist)
      );

      if (blockObj) {
        return `
          <div class="p-2 ${borderClass} flex flex-col gap-1.5 bg-surface-container-high/50">
            <span class="text-[10px] text-warning font-bold">${rowBlockKey} • Bloqueado</span>
            <div onclick="TurnosApp.removeBlockedSlot('${blockObj.id}')" class="p-2 rounded bg-surface-container-high border border-outline text-[11px] flex flex-col justify-between cursor-pointer hover:border-error" title="Clic para desbloquear este horario">
              <p class="font-semibold text-on-surface truncate">${blockObj.reason}</p>
              <span class="text-[10px] text-primary font-semibold mt-1">Clic para liberar</span>
            </div>
          </div>
        `;
      }

      const cellApts = state.appointments.filter((a) => {
        const matchesSlot = a.date === day.date && a.rowBlock === rowBlockKey;
        const matchesSpec = ui.calendarSpecialist === 'all' || a.specialistId === ui.calendarSpecialist;
        return matchesSlot && matchesSpec;
      });

      if (cellApts.length === 0) {
        const emptyLabel = day.dayCol === 2 && rowBlockKey === '09:00' ? 'Disponible' : 'Libre';
        return `
          <div class="p-2 ${borderClass} flex flex-col gap-1.5 bg-surface">
            <span class="text-[10px] text-on-surface-variant font-semibold">${rowBlockKey}</span>
            <div onclick="TurnosApp.openNewAppointmentModal({ date: '${day.date}', time: '${rowBlockKey}' })" class="h-full min-h-[58px] flex items-center justify-center border border-dashed border-outline-variant rounded text-on-surface-variant text-[11px] font-medium bg-surface-container-low hover:border-primary hover:text-primary cursor-pointer transition-all" title="Clic para agendar en este horario">
              + ${emptyLabel}
            </div>
          </div>
        `;
      }

      const apt = cellApts[0];
      const isPending = apt.status === 'pending';

      if (day.isToday) {
        const containerBg = isPending ? 'bg-warning-container/20' : 'bg-primary-container/10';
        const timeColor = isPending ? 'text-warning' : 'text-primary';
        const borderLeft = isPending ? 'border-warning' : 'border-success';
        const dotColor = isPending ? 'bg-warning' : 'bg-success';

        return `
          <div class="p-2 ${borderClass} flex flex-col gap-1.5 ${containerBg}">
            <span class="text-[10px] ${timeColor} font-bold">${apt.time}${isPending ? ' (Pendiente)' : ''}</span>
            <div onclick="TurnosApp.openAppointmentModal('${apt.id}')" class="p-2.5 rounded-md bg-surface border-l-4 ${borderLeft} shadow-xs text-[11px] flex flex-col justify-between cursor-pointer hover:shadow-md transition-all" title="Clic para editar o gestionar este turno">
              <div>
                <div class="flex items-center justify-between">
                  <p class="font-semibold text-on-surface truncate">${apt.clientName}</p>
                  <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
                </div>
                <p class="text-on-surface-variant truncate mt-0.5">${apt.shortService || apt.serviceName}</p>
              </div>
              <div class="flex items-center justify-between text-[10px] ${isPending ? '' : 'text-primary'} font-medium mt-1">
                <span class="${isPending ? 'text-on-surface-variant' : ''}">${apt.specialistShort}</span>
                <span class="${isPending ? 'font-bold text-on-surface' : ''}">${formatARS(apt.price)}</span>
              </div>
            </div>
          </div>
        `;
      }

      const cardBg = day.isSat ? 'bg-secondary-container/40' : 'bg-surface-container';
      return `
        <div class="p-2 ${borderClass} flex flex-col gap-1.5 bg-surface">
          <span class="text-[10px] text-on-surface-variant font-semibold">${apt.time}</span>
          <div onclick="TurnosApp.openAppointmentModal('${apt.id}')" class="p-2 rounded ${cardBg} border border-outline-variant text-[11px] hover:border-primary cursor-pointer transition-all" title="Clic para editar este turno">
            <p class="font-semibold text-on-surface truncate">${apt.clientName}</p>
            <p class="text-on-surface-variant truncate">${apt.shortService || apt.serviceName} • ${apt.specialistShort}</p>
          </div>
        </div>
      `;
    }

    // Sub-renderer for DAY View (by specialist columns)
    function renderDaySubView() {
      const dayInfo = getDayInfoByDate(ui.calendarSelectedDate);
      const daySlots = ['09:00', '09:30', '10:30', '11:15', '13:00', '14:00', '15:00', '16:30', '18:00'];
      const specsToShow =
        ui.calendarSpecialist === 'all'
          ? state.specialists
          : state.specialists.filter((s) => s.id === ui.calendarSpecialist);

      return `
        <div class="bg-surface rounded-lg border border-outline-variant shadow-sm overflow-hidden">
          <div class="p-4 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="font-display text-headline-lg font-semibold text-on-surface">Agenda Diaria Detallada — ${dayInfo.fullLabel}</span>
            </div>
            <div class="flex items-center gap-2">
              ${ALL_DAYS.map(
                (d) => `
                <button type="button" onclick="TurnosApp.setCalendarViewMode('day', '${d.date}')" class="px-2.5 py-1 rounded text-label-sm ${
                  d.date === ui.calendarSelectedDate ? 'bg-primary text-white font-bold' : 'bg-surface border border-outline-variant text-on-surface-variant'
                }">${d.label} ${d.num}</button>
              `
              ).join('')}
            </div>
          </div>

          <div class="grid grid-cols-${specsToShow.length} divide-x divide-outline-variant">
            ${specsToShow
              .map(
                (sp) => `
              <div class="flex flex-col">
                <div class="p-4 bg-surface-container/50 border-b border-outline-variant flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full ${sp.avatarBg} font-display font-bold flex items-center justify-center text-label-sm">${sp.initials}</div>
                    <div>
                      <p class="font-semibold text-on-surface text-body-sm">${sp.name}</p>
                      <p class="text-[11px] text-on-surface-variant">${sp.role}</p>
                    </div>
                  </div>
                  <button type="button" onclick="TurnosApp.openNewAppointmentModal({ date: '${dayInfo.date}', specialistId: '${sp.id}' })" class="text-label-sm text-primary font-semibold hover:underline">+ Turno</button>
                </div>
                <div class="divide-y divide-outline-variant/60">
                  ${daySlots
                    .map((slot) => {
                      if (slot === '13:00') {
                        return `<div class="p-3 bg-surface-container text-on-surface-variant text-[11px] font-medium flex items-center gap-2"><span class="material-symbols-outlined text-body-sm text-primary">restaurant</span> Pausa de Almuerzo (${state.business.lunchBreak.start}-${state.business.lunchBreak.end})</div>`;
                      }
                      const apt = state.appointments.find(
                        (a) => a.date === dayInfo.date && a.specialistId === sp.id && (a.time === slot || (slot === '09:00' && a.time === '09:15'))
                      );
                      if (apt) {
                        return `
                          <div onclick="TurnosApp.openAppointmentModal('${apt.id}')" class="p-3 bg-primary-container/15 hover:bg-primary-container/30 cursor-pointer flex items-center justify-between transition-all">
                            <div>
                              <span class="text-[11px] font-bold text-primary">${apt.time} hs (${apt.duration}m + ${state.business.bufferMinutes}m limpieza)</span>
                              <p class="font-semibold text-on-surface text-body-sm">${apt.clientName}</p>
                              <p class="text-[12px] text-on-surface-variant">${apt.serviceName}</p>
                            </div>
                            <span class="font-bold text-on-surface text-body-sm">${formatARS(apt.price)}</span>
                          </div>
                        `;
                      }
                      return `
                        <div onclick="TurnosApp.openNewAppointmentModal({ date: '${dayInfo.date}', time: '${slot}', specialistId: '${sp.id}' })" class="p-3 hover:bg-surface-container-low cursor-pointer flex items-center justify-between text-on-surface-variant text-[12px]">
                          <span class="tabular-nums font-medium">${slot} hs</span>
                          <span class="text-primary/70 hover:text-primary font-medium">+ Disponible</span>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    // Sub-renderer for MONTH View (Full Nov 2026 Grid)
    function renderMonthSubView() {
      const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1);
      return `
        <div class="bg-surface rounded-lg border border-outline-variant shadow-sm overflow-hidden">
          <div class="p-4 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
            <h3 class="font-display text-headline-lg font-semibold text-on-surface">Calendario Mensual — Noviembre 2026</h3>
            <span class="text-label-sm text-primary font-semibold">312 turnos programados en el mes</span>
          </div>
          <div class="grid grid-cols-6 border-b border-outline-variant bg-surface-container text-center py-2 text-label-sm font-semibold text-on-surface-variant">
            <div>Lunes</div><div>Martes</div><div>Miércoles</div><div>Jueves</div><div>Viernes</div><div>Sábado</div>
          </div>
          <div class="grid grid-cols-6 divide-x divide-y divide-outline-variant">
            ${daysInMonth
              .filter((d) => d % 7 !== 1) // 6 working days per week (Lun-Sáb)
              .slice(0, 24)
              .map((dayNum) => {
                const dateStr = `2026-11-${String(dayNum).padStart(2, '0')}`;
                const matchedDay = ALL_DAYS.find((ad) => Number(ad.num) === dayNum);
                const count = matchedDay
                  ? state.appointments.filter((a) => a.date === dateStr).length + 12
                  : 10 + (dayNum % 8);
                const isCurrentWeek = dayNum >= 16 && dayNum <= 21;
                return `
                  <div onclick="${
                    matchedDay
                      ? `TurnosApp.setCalendarViewMode('day', '${dateStr}')`
                      : `TurnosApp.setCalendarViewMode('week')`
                  }" class="p-3 min-h-[92px] flex flex-col justify-between cursor-pointer hover:bg-primary-container/15 transition-all ${
                    dayNum === 17 ? 'bg-primary-container/20 border-t-2 border-t-primary' : 'bg-surface'
                  }">
                    <div class="flex items-center justify-between">
                      <span class="font-display text-title-lg font-bold ${dayNum === 17 ? 'text-primary' : 'text-on-surface'}">${dayNum} Nov</span>
                      ${dayNum === 17 ? `<span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-bold">HOY</span>` : ''}
                    </div>
                    <div class="flex flex-col gap-1 mt-2">
                      <span class="text-[11px] font-semibold ${isCurrentWeek ? 'text-primary' : 'text-on-surface-variant'}">${count} turnos</span>
                      <span class="text-[10px] text-success font-medium">${formatARS(count * 18500)} est.</span>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div class="flex items-center gap-6">
          <div>
            <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Planificación Operativa</span>
            <h1 class="font-display text-display-lg text-on-surface italic">Semana del ${daysHeader[0].numDisplay} al ${daysHeader[5].numDisplay} de Noviembre</h1>
          </div>

          <div class="flex items-center gap-1 bg-surface-container p-1 rounded-md border border-outline-variant">
            <button type="button" onclick="TurnosApp.shiftCalendarWeek(-1)" class="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface" aria-label="Anterior">
              <span class="material-symbols-outlined text-title-md">chevron_left</span>
            </button>
            <button type="button" onclick="TurnosApp.calendarWeekOffset = 0; TurnosApp.setCalendarViewMode('week')" class="font-label text-label-sm px-2 font-semibold text-on-surface hover:text-primary">Hoy: Nov 2026</button>
            <button type="button" onclick="TurnosApp.shiftCalendarWeek(1)" class="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface" aria-label="Siguiente">
              <span class="material-symbols-outlined text-title-md">chevron_right</span>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2 bg-surface border border-outline px-3 py-1.5 rounded-md text-body-sm">
            <span class="material-symbols-outlined text-title-md text-primary">person</span>
            <select onchange="TurnosApp.setCalendarSpecialist(this.value)" class="bg-transparent text-on-surface font-medium border-none p-0 pr-6 focus:ring-0 cursor-pointer text-body-sm">
              <option value="all" ${ui.calendarSpecialist === 'all' ? 'selected' : ''}>Todos los especialistas (${state.specialists.length})</option>
              ${state.specialists
                .map(
                  (sp) =>
                    `<option value="${sp.id}" ${ui.calendarSpecialist === sp.id ? 'selected' : ''}>${sp.name} (${sp.role})</option>`
                )
                .join('')}
            </select>
          </div>

          <!-- View Mode: Day / Week / Month -->
          <div class="flex items-center gap-1 bg-surface-container p-1 rounded-md border border-outline-variant">
            <button type="button" onclick="TurnosApp.setCalendarViewMode('day')" class="px-2.5 py-1 rounded text-label-sm ${
              ui.calendarViewMode === 'day' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Día</button>
            <button type="button" onclick="TurnosApp.setCalendarViewMode('week')" class="px-3 py-1 rounded text-label-sm ${
              ui.calendarViewMode === 'week' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Semana</button>
            <button type="button" onclick="TurnosApp.setCalendarViewMode('month')" class="px-2.5 py-1 rounded text-label-sm ${
              ui.calendarViewMode === 'month' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Mes</button>
          </div>

          <button type="button" onclick="TurnosApp.openBlockScheduleModal()" class="inline-flex items-center gap-1.5 px-3 py-2 border border-outline bg-surface rounded-md font-label text-label-sm hover:bg-surface-container transition-all whitespace-nowrap">
            <span class="material-symbols-outlined text-title-md text-warning">block</span>
            <span>Bloquear</span>
          </button>

          <button type="button" onclick="TurnosApp.openNewAppointmentModal()" class="inline-flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-md font-label text-label-md shadow-sm hover:opacity-95 active:scale-95 transition-all whitespace-nowrap">
            <span class="material-symbols-outlined text-title-md text-white">add</span>
            <span>Nuevo turno</span>
          </button>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-6">
        ${
          ui.calendarViewMode === 'day'
            ? renderDaySubView()
            : ui.calendarViewMode === 'month'
            ? renderMonthSubView()
            : `
          <div class="bg-surface rounded-lg border border-outline-variant shadow-sm flex flex-col overflow-hidden">
            <div class="grid grid-cols-6 border-b border-outline-variant bg-surface-container-low text-center">
              ${daysHeader
                .map((d, i) => {
                  if (d.isToday) {
                    return `
                      <div onclick="TurnosApp.setCalendarViewMode('day', '${d.date}')" class="py-3 px-2 border-r border-outline-variant bg-primary-container/20 flex flex-col items-center border-t-2 border-t-primary cursor-pointer hover:bg-primary-container/30" title="Ver detalle del día">
                        <span class="text-label-sm uppercase font-bold text-primary">${d.name}</span>
                        <span class="font-display text-title-lg font-bold text-primary tabular-nums">${d.numDisplay}</span>
                        <span class="text-[10px] text-primary font-semibold mt-0.5">${d.countLabel}</span>
                      </div>
                    `;
                  }
                  return `
                    <div onclick="TurnosApp.setCalendarViewMode('day', '${d.date}')" class="py-3 px-2 ${i < 5 ? 'border-r border-outline-variant' : ''} flex flex-col items-center cursor-pointer hover:bg-surface-container" title="Ver detalle del día">
                      <span class="text-label-sm uppercase font-semibold text-on-surface-variant">${d.name}</span>
                      <span class="font-display text-title-lg font-bold text-on-surface tabular-nums">${d.numDisplay}</span>
                      <span class="text-[10px] ${d.isSat ? 'text-primary font-semibold' : 'text-on-surface-variant'} mt-0.5">${d.countLabel}</span>
                    </div>
                  `;
                })
                .join('')}
            </div>

            <div class="divide-y divide-outline-variant/60 text-body-sm">
              ${timeBlocks
                .map((block) => {
                  if (block.key === 'LUNCH') {
                    return `
                      <div class="grid grid-cols-6 bg-surface-container py-3 border-y border-outline-variant">
                        <div class="col-span-6 px-6 flex items-center justify-between text-on-surface-variant text-label-sm">
                          <span class="flex items-center gap-2 font-medium">
                            <span class="material-symbols-outlined text-body-sm text-primary">restaurant</span>
                            Pausa de Almuerzo &amp; Desinfección de Box (${state.business.lunchBreak.start} - ${state.business.lunchBreak.end} hs)
                          </span>
                          <span class="text-[11px] text-on-surface-variant font-normal">Bloqueado para reservas públicas en la web</span>
                        </div>
                      </div>
                    `;
                  }
                  return `
                    <div class="grid grid-cols-6 min-h-[96px]">
                      ${daysHeader.map((day) => renderWeekCell(day, block.key)).join('')}
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
        }

        <div class="flex items-center justify-between text-body-sm text-on-surface-variant px-2 flex-wrap gap-4">
          <div class="flex items-center gap-6 flex-wrap">
            <span class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded-full bg-success"></span> Confirmado (clic para editar)
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded-full bg-warning"></span> Pendiente de aprobación
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded bg-surface-container border border-outline-variant"></span> Horario libre en web (clic para agendar)
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded bg-surface-container-high"></span> Bloqueo manual / descanso
            </span>
          </div>
          <span class="font-medium text-primary">Zona horaria: GMT-3 (Buenos Aires)</span>
        </div>
      </div>
    `;
  }

  // SCREEN 4: Clientes & CRM — TurnosApp (100% Funcional)
  function renderClientsView() {
    const search = ui.clientSearch.trim().toLowerCase();
    const filteredClients = state.clients.filter((c) => {
      const matchesTab =
        ui.clientFilter === 'all' ||
        (ui.clientFilter === 'frecuente' && c.category === 'frecuente') ||
        (ui.clientFilter === 'nuevo' && c.category === 'nuevo');
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search) ||
        c.phone.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search) ||
        (c.favoriteService || '').toLowerCase().includes(search);
      return matchesTab && matchesSearch;
    });

    const totalPages = Math.max(1, Math.ceil(filteredClients.length / ui.clientPageSize));
    const safePage = Math.min(ui.clientPage, totalPages);
    const pagedClients = filteredClients.slice((safePage - 1) * ui.clientPageSize, safePage * ui.clientPageSize);

    const selectedClient =
      state.clients.find((c) => c.id === ui.selectedClientId) || filteredClients[0] || state.clients[0];

    const clientApts = selectedClient
      ? state.appointments.filter(
          (a) => a.clientId === selectedClient.id || a.clientName.toLowerCase() === selectedClient.name.toLowerCase()
        )
      : [];

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Directorio de Confianza</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Fichas de Clientes &amp; Preferencias</h1>
        </div>

        <div class="flex items-center gap-3">
          <div class="relative flex items-center">
            <span class="material-symbols-outlined absolute left-3 text-on-surface-variant text-title-md">search</span>
            <input id="crm-search-input" type="text" value="${ui.clientSearch}" oninput="TurnosApp.setClientSearch(this.value)" placeholder="Buscar por nombre, celular o servicio..." class="w-72 pl-9 pr-3.5 py-2 bg-surface border border-outline rounded-md text-body-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:ring-1 focus:ring-primary">
          </div>

          <button type="button" onclick="TurnosApp.openNewClientModal()" class="inline-flex items-center gap-2 px-5 py-2 bg-primary text-on-primary rounded-md font-label text-label-lg shadow-sm hover:opacity-95 active:scale-95 transition-all duration-state-change whitespace-nowrap">
            <span class="material-symbols-outlined text-title-lg text-white">person_add</span>
            <span>Registrar cliente</span>
          </button>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <section class="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <article class="bg-surface p-5 rounded-lg border border-outline-variant shadow-sm flex items-center justify-between">
            <div>
              <span class="font-label text-label-sm text-on-surface-variant uppercase tracking-wider block mb-1">Base Total</span>
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${422 + state.clients.length} socios</h2>
              <p class="text-body-sm text-on-surface-variant mt-0.5">Con ficha clínica / preferencias</p>
            </div>
            <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
              <span class="material-symbols-outlined text-headline-md">groups</span>
            </div>
          </article>

          <article class="bg-surface p-5 rounded-lg border border-outline-variant shadow-sm flex items-center justify-between">
            <div>
              <span class="font-label text-label-sm text-on-surface-variant uppercase tracking-wider block mb-1">Recurrentes</span>
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">76.4%</h2>
              <p class="text-body-sm text-success font-medium mt-0.5">Vuelven cada 20 a 30 días</p>
            </div>
            <div class="w-10 h-10 rounded-full bg-success-container text-on-success-container flex items-center justify-center">
              <span class="material-symbols-outlined text-headline-md">repeat</span>
            </div>
          </article>

          <article class="bg-surface p-5 rounded-lg border border-outline-variant shadow-sm flex items-center justify-between">
            <div>
              <span class="font-label text-label-sm text-on-surface-variant uppercase tracking-wider block mb-1">Sin Ausencias</span>
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">99.1%</h2>
              <p class="text-body-sm text-on-surface-variant mt-0.5">Gracias al recordatorio WhatsApp</p>
            </div>
            <div class="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
              <span class="material-symbols-outlined text-headline-md">verified_user</span>
            </div>
          </article>
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-2 bg-surface rounded-lg border border-outline-variant shadow-sm flex flex-col">
            <div class="p-6 border-b border-outline-variant flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 class="font-display text-headline-lg font-semibold text-on-surface">Directorio Activo</h3>
                <p class="font-body text-body-sm text-on-surface-variant mt-0.5">
                  Historial de visitas, servicios más pedidos y observaciones confidenciales del personal.
                </p>
              </div>

              <div class="flex items-center gap-1 bg-surface-container p-1 rounded-md shrink-0">
                <button type="button" onclick="TurnosApp.setClientFilter('all')" class="px-3.5 py-1.5 rounded text-label-sm ${
                  ui.clientFilter === 'all' ? 'bg-surface font-semibold text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
                }">Todos (${state.clients.length})</button>
                <button type="button" onclick="TurnosApp.setClientFilter('frecuente')" class="px-3.5 py-1.5 rounded text-label-sm ${
                  ui.clientFilter === 'frecuente' ? 'bg-surface font-semibold text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
                }">Frecuentes (${state.clients.filter((c) => c.category === 'frecuente').length})</button>
                <button type="button" onclick="TurnosApp.setClientFilter('nuevo')" class="px-3.5 py-1.5 rounded text-label-sm ${
                  ui.clientFilter === 'nuevo' ? 'bg-surface font-semibold text-primary shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
                }">Nuevos (${state.clients.filter((c) => c.category === 'nuevo').length})</button>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-outline-variant bg-surface-container-low text-label-sm font-semibold text-on-surface-variant">
                    <th class="py-3.5 px-6">Cliente</th>
                    <th class="py-3.5 px-4">Teléfono (WhatsApp)</th>
                    <th class="py-3.5 px-4">Visitas</th>
                    <th class="py-3.5 px-4">Última visita</th>
                    <th class="py-3.5 px-4">Servicio habitual</th>
                    <th class="py-3.5 px-6 text-right">Ficha</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant text-body-md text-on-surface">
                  ${pagedClients
                    .map((c) => {
                      const isSelected = selectedClient && selectedClient.id === c.id;
                      const rowClass = isSelected
                        ? 'bg-primary-container/20 border-l-4 border-primary'
                        : 'hover:bg-surface-container-low/60 cursor-pointer';
                      return `
                        <tr onclick="TurnosApp.selectClient('${c.id}')" class="${rowClass} transition-colors">
                          <td class="py-4 px-6">
                            <div class="flex items-center gap-3">
                              <div class="w-9 h-9 rounded-full ${c.avatarBg} font-display font-semibold flex items-center justify-center text-label-md shrink-0">
                                ${c.initials}
                              </div>
                              <div>
                                <div class="font-semibold text-on-surface flex items-center gap-1.5">
                                  <span>${c.name}</span>
                                  ${
                                    c.isNew
                                      ? `<span class="text-[10px] font-semibold bg-surface-container text-primary px-1.5 py-0.5 rounded">Nueva</span>`
                                      : ''
                                  }
                                </div>
                                <div class="text-body-sm text-on-surface-variant">${c.email}</div>
                              </div>
                            </div>
                          </td>
                          <td class="py-4 px-4 font-medium text-body-sm tabular-nums">
                            <div class="flex items-center gap-1.5 ${isSelected ? 'text-primary' : 'text-on-surface-variant'}">
                              <span class="material-symbols-outlined text-body-sm ${isSelected ? 'text-primary' : 'text-success'}">chat</span>
                              <span>${c.phone}</span>
                            </div>
                          </td>
                          <td class="py-4 px-4 font-bold tabular-nums">${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'}</td>
                          <td class="py-4 px-4 text-body-sm ${c.lastVisit.includes('Pend') ? 'text-warning font-medium' : 'text-on-surface-variant'}">${c.lastVisit}</td>
                          <td class="py-4 px-4">
                            <span class="inline-flex items-center text-label-sm bg-surface-container px-2 py-0.5 rounded text-on-surface font-medium">
                              ${c.favoriteService}
                            </span>
                          </td>
                          <td class="py-4 px-6 text-right">
                            ${
                              isSelected
                                ? `<span class="text-label-sm font-bold text-primary">Viendo</span>`
                                : `<button type="button" class="text-label-md text-primary font-semibold hover:underline">Abrir</button>`
                            }
                          </td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>

            <div class="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between text-body-sm text-on-surface-variant">
              <span>Página ${safePage} de ${totalPages} (${filteredClients.length} clientes filtrados)</span>
              <div class="flex items-center gap-2">
                <button type="button" ${safePage <= 1 ? 'disabled' : ''} onclick="TurnosApp.setClientPage(${safePage - 1})" class="px-2.5 py-1 border border-outline rounded bg-surface text-label-sm font-medium hover:bg-surface-container disabled:opacity-40">Anterior</button>
                <button type="button" ${safePage >= totalPages ? 'disabled' : ''} onclick="TurnosApp.setClientPage(${safePage + 1})" class="px-2.5 py-1 border border-outline rounded bg-surface text-label-sm font-medium hover:bg-surface-container disabled:opacity-40">Siguiente</button>
              </div>
            </div>
          </div>

          <!-- Right Col: Selected Client Profile Dossier -->
          <div class="flex flex-col gap-6">
            ${
              selectedClient
                ? `
              <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-5">
                <div class="flex items-start justify-between border-b border-outline-variant pb-4">
                  <div class="flex items-center gap-3">
                    <div class="w-14 h-14 rounded-full bg-primary text-white font-display font-semibold flex items-center justify-center text-headline-lg shadow-sm">
                      ${selectedClient.initials}
                    </div>
                    <div>
                      <h3 class="font-display text-headline-lg font-semibold text-on-surface">${selectedClient.name}</h3>
                      <p class="font-body text-body-sm text-on-surface-variant">${selectedClient.category === 'nuevo' ? 'Cliente nuevo' : 'Cliente frecuente'} • Desde ${selectedClient.since}</p>
                    </div>
                  </div>
                  <button type="button" onclick="TurnosApp.openClientModal('${selectedClient.id}')" class="text-primary hover:text-secondary p-1" title="Editar datos del cliente">
                    <span class="material-symbols-outlined text-title-lg">edit</span>
                  </button>
                </div>

                <a href="https://wa.me/${selectedClient.phoneClean}?text=${encodeURIComponent(`Hola ${selectedClient.name}, te escribimos de Studio Bellas...`)}" target="_blank" rel="noopener" class="w-full py-2.5 px-4 bg-success-container text-on-success-container rounded-md font-label text-label-md font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition-all">
                  <span class="material-symbols-outlined text-title-md">chat</span>
                  Abrir conversación de WhatsApp
                </a>

                <div class="grid grid-cols-2 gap-3 py-2 border-y border-outline-variant text-body-sm">
                  <div>
                    <span class="text-on-surface-variant block text-label-sm">Inversión acumulada</span>
                    <span class="font-bold text-on-surface tabular-nums text-title-md">${formatARS(selectedClient.totalSpent)}</span>
                  </div>
                  <div>
                    <span class="text-on-surface-variant block text-label-sm">Promedio asistencia</span>
                    <span class="font-bold text-success tabular-nums text-title-md">${selectedClient.attendance}</span>
                  </div>
                </div>

                ${
                  clientApts.length > 0
                    ? `
                  <div class="flex flex-col gap-1.5">
                    <span class="font-label text-label-sm font-semibold text-on-surface">Turnos Registrados (${clientApts.length})</span>
                    ${clientApts
                      .slice(0, 2)
                      .map(
                        (ca) => `
                      <div onclick="TurnosApp.openAppointmentModal('${ca.id}')" class="p-2.5 rounded bg-surface-container-low border border-outline-variant text-[12px] flex items-center justify-between cursor-pointer hover:border-primary">
                        <div>
                          <span class="font-semibold text-on-surface">${ca.shortService || ca.serviceName}</span>
                          <span class="text-on-surface-variant block">${ca.date} • ${ca.time} hs con ${ca.specialistShort}</span>
                        </div>
                        <span class="font-bold text-primary">${formatARS(ca.price)}</span>
                      </div>
                    `
                      )
                      .join('')}
                  </div>
                `
                    : ''
                }

                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <span class="font-label text-label-sm font-semibold text-on-surface flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-body-sm text-primary">sticky_note_2</span>
                      Notas del Equipo (Confidencial)
                    </span>
                    <button type="button" onclick="TurnosApp.openAddClientNoteModal('${selectedClient.id}')" class="text-label-sm text-primary font-semibold hover:underline">+ Añadir</button>
                  </div>

                  ${
                    selectedClient.notes.length === 0
                      ? `<p class="text-body-sm text-on-surface-variant italic py-2">Sin observaciones registradas todavía.</p>`
                      : selectedClient.notes
                          .map(
                            (n, nIdx) => `
                        <div class="bg-surface-container-low p-3.5 rounded-md border border-outline-variant text-body-sm flex flex-col gap-2 group">
                          <div class="flex items-center justify-between text-[11px] text-on-surface-variant border-b border-outline-variant/60 pb-1">
                            <span class="font-semibold text-on-surface">${n.author}</span>
                            <div class="flex items-center gap-2">
                              <span>${n.date}</span>
                              <button type="button" onclick="TurnosApp.deleteClientNote('${selectedClient.id}', ${nIdx})" class="text-error opacity-60 hover:opacity-100" title="Borrar nota">×</button>
                            </div>
                          </div>
                          <p class="text-on-surface text-body-sm leading-relaxed">
                            "${n.text}"
                          </p>
                        </div>
                      `
                          )
                          .join('')
                  }
                </div>

                <button type="button" onclick="TurnosApp.openNewAppointmentModal({ clientName: '${selectedClient.name}' })" class="w-full py-2.5 bg-primary text-white rounded-md font-label text-label-md font-semibold hover:opacity-95 transition-all shadow-xs mt-1">
                  Agendar próxima sesión para ${selectedClient.name.split(' ')[0]}
                </button>
              </section>
            `
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  // SCREEN 3: Servicios & Tiempos — TurnosApp (100% Funcional)
  function renderServicesView() {
    const lunchDays = [
      { key: 'L', label: 'L' },
      { key: 'M', label: 'M' },
      { key: 'X', label: 'M' },
      { key: 'J', label: 'J' },
      { key: 'V', label: 'V' },
      { key: 'S', label: 'S' }
    ];

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Configuración Operativa</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Catálogo de Servicios &amp; Pausas</h1>
        </div>

        <div class="flex items-center gap-3">
          <button type="button" onclick="TurnosApp.toggleBufferRule()" class="inline-flex items-center gap-2 px-4 py-2 border border-outline bg-surface rounded-md font-label text-label-lg hover:bg-surface-container transition-all duration-state-change">
            <span class="material-symbols-outlined text-title-lg text-on-surface-variant">timer</span>
            <span>Tiempos de limpieza (+${state.business.bufferMinutes}m)</span>
          </button>

          <button type="button" onclick="TurnosApp.openServiceModal()" class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-md font-label text-label-lg shadow-sm hover:opacity-95 active:scale-95 transition-all duration-state-change whitespace-nowrap">
            <span class="material-symbols-outlined text-title-lg text-white">add</span>
            <span>Crear nuevo servicio</span>
          </button>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <div class="bg-surface-container-low border border-outline-variant p-4 rounded-lg flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0 mt-0.5">
              <span class="material-symbols-outlined text-title-md">tips_and_updates</span>
            </div>
            <div>
              <h2 class="font-body text-title-md font-semibold text-on-surface">Regla de buffers automáticos entre clientes</h2>
              <p class="font-body text-body-sm text-on-surface-variant mt-0.5">
                Cada servicio incluye un tiempo de gracia configurable (10 a 15 min) para esterilizar herramientas, ventilar el box y evitar que el próximo cliente espere de pie.
              </p>
            </div>
          </div>
          <button type="button" onclick="TurnosApp.toggleBufferRule()" class="text-label-sm font-semibold bg-success-container text-on-success-container px-2.5 py-1 rounded-full shrink-0 hover:opacity-90">
            Regla activa: +${state.business.bufferMinutes} min
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-2 bg-surface rounded-lg border border-outline-variant shadow-sm flex flex-col">
            <div class="p-6 border-b border-outline-variant flex items-center justify-between">
              <div>
                <h3 class="font-display text-headline-lg font-semibold text-on-surface">Servicios Habilitados</h3>
                <p class="font-body text-body-sm text-on-surface-variant mt-0.5">
                  Modifica duración neta, precio visible para el cliente y especialistas asignados.
                </p>
              </div>
              <span class="text-label-sm text-on-surface-variant">${state.services.length} activos en web</span>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-outline-variant bg-surface-container-low text-label-sm font-semibold text-on-surface-variant">
                    <th class="py-3.5 px-6">Servicio</th>
                    <th class="py-3.5 px-4">Duración</th>
                    <th class="py-3.5 px-4">Tiempo extra</th>
                    <th class="py-3.5 px-4">Precio</th>
                    <th class="py-3.5 px-4">Especialistas</th>
                    <th class="py-3.5 px-6 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant text-body-md text-on-surface">
                  ${state.services
                    .map(
                      (srv) => `
                    <tr class="hover:bg-surface-container-low/60 transition-colors">
                      <td class="py-4 px-6">
                        <div class="font-semibold text-on-surface">${srv.shortName}</div>
                        <div class="text-body-sm text-on-surface-variant">${srv.description}</div>
                      </td>
                      <td class="py-4 px-4 font-medium tabular-nums">${srv.duration} min</td>
                      <td class="py-4 px-4">
                        <span class="inline-flex items-center gap-1 text-label-sm bg-surface-container px-2 py-0.5 rounded font-medium text-primary">
                          +${srv.extraBuffer} min
                        </span>
                      </td>
                      <td class="py-4 px-4 font-bold tabular-nums">${formatARS(srv.price)}</td>
                      <td class="py-4 px-4">
                        <div class="flex items-center -space-x-1.5">
                          ${(srv.specialists || ['sm'])
                            .map((spId) => {
                              const sp = state.specialists.find((s) => s.id === spId) || state.specialists[0];
                              const bg = sp.id === 'mc' && srv.specialists.length === 1 ? 'bg-secondary' : 'bg-brand-roble';
                              return `<span class="w-6 h-6 rounded-full ${bg} text-white text-[10px] font-bold flex items-center justify-center border border-surface" title="${sp.name}">${sp.initials}</span>`;
                            })
                            .join('')}
                        </div>
                      </td>
                      <td class="py-4 px-6 text-right">
                        <button type="button" onclick="TurnosApp.openServiceModal('${srv.id}')" class="text-label-md text-primary font-semibold hover:underline">Editar</button>
                      </td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>

            <div class="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between text-body-sm text-on-surface-variant">
              <span>El cliente solo ve la duración de la sesión, no el tiempo de descanso posterior.</span>
              <button type="button" onclick="TurnosApp.downloadCatalogPdf()" class="text-primary font-semibold hover:underline flex items-center gap-1">
                <span class="material-symbols-outlined text-body-md">picture_as_pdf</span>
                Descargar lista PDF
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-6">
            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-title-lg text-primary">restaurant</span>
                  <h3 class="font-display text-headline-md font-semibold text-on-surface">Horario de Almuerzo</h3>
                </div>
                <span class="text-label-sm bg-success-container text-on-success-container px-2 py-0.5 rounded font-semibold">Bloqueado</span>
              </div>
              <p class="font-body text-body-sm text-on-surface-variant">
                Franja automática donde la web pública no muestra turnos disponibles para nadie del equipo.
              </p>

              <div class="flex items-center gap-3 pt-2">
                <div class="flex-1">
                  <label class="text-label-sm font-semibold text-on-surface-variant block mb-1">Inicio pausa</label>
                  <input id="lunch-start-input" type="text" value="${state.business.lunchBreak.start}" class="w-full px-3 py-2 bg-surface-container border border-outline rounded-md text-on-surface font-semibold tabular-nums">
                </div>
                <span class="mt-5 text-on-surface-variant font-medium">a</span>
                <div class="flex-1">
                  <label class="text-label-sm font-semibold text-on-surface-variant block mb-1">Fin pausa</label>
                  <input id="lunch-end-input" type="text" value="${state.business.lunchBreak.end}" class="w-full px-3 py-2 bg-surface-container border border-outline rounded-md text-on-surface font-semibold tabular-nums">
                </div>
              </div>

              <div class="pt-2">
                <label class="text-label-sm font-semibold text-on-surface-variant block mb-1.5">Días aplicados (clic para alternar)</label>
                <div class="flex items-center gap-1.5">
                  ${lunchDays
                    .map((d) => {
                      const active = state.business.lunchBreak.days.includes(d.key);
                      return `<button type="button" onclick="TurnosApp.toggleLunchDay('${d.key}')" class="w-8 h-8 rounded ${
                        active ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'
                      } text-label-sm font-bold flex items-center justify-center transition-all">${d.label}</button>`;
                    })
                    .join('')}
                </div>
              </div>
            </section>

            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-title-lg text-primary">policy</span>
                  <h3 class="font-display text-headline-lg font-semibold text-on-surface">Políticas para Clientes</h3>
                </div>
              </div>

              <div class="flex flex-col gap-3 text-body-sm">
                <div>
                  <label class="text-label-sm font-semibold text-on-surface block mb-1">Anticipación mínima para reservar</label>
                  <select id="policy-min-advance" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
                    ${['2 horas antes del turno', '4 horas antes', '24 horas antes']
                      .map((opt) => `<option ${state.business.policies.minAdvance === opt ? 'selected' : ''}>${opt}</option>`)
                      .join('')}
                  </select>
                </div>

                <div>
                  <label class="text-label-sm font-semibold text-on-surface block mb-1">Límite para cancelar sin penalización</label>
                  <select id="policy-cancel-limit" class="w-full px-3 py-2 bg-surface border border-outline rounded-md text-on-surface text-body-sm">
                    ${['Hasta 4 horas antes', 'Hasta 12 horas antes', 'Hasta 24 horas antes']
                      .map((opt) => `<option ${state.business.policies.cancelLimit === opt ? 'selected' : ''}>${opt}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <button type="button" onclick="TurnosApp.saveClientPolicies()" class="w-full py-2.5 bg-primary text-white font-label text-label-md font-semibold rounded-md shadow-xs hover:opacity-95 transition-all mt-1">
                Guardar políticas de reserva
              </button>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  // Especialistas View (100% Funcional)
  function renderSpecialistsView() {
    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Equipo &amp; Atelier</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Especialistas &amp; Liquidación de Comisiones</h1>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" onclick="TurnosApp.setTab('calendar')" class="inline-flex items-center gap-2 px-4 py-2 border border-outline bg-surface rounded-md font-label text-label-md hover:bg-surface-container">
            <span class="material-symbols-outlined text-title-md text-primary">calendar_month</span>
            <span>Ver agendas</span>
          </button>
          <button type="button" onclick="TurnosApp.openSpecialistModal()" class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-md font-label text-label-lg shadow-sm hover:opacity-95">
            <span class="material-symbols-outlined text-title-lg text-white">person_add</span>
            <span>Incorporar especialista</span>
          </button>
        </div>
      </header>

      <div class="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        ${state.specialists
          .map((sp) => {
            const assignedApts = state.appointments.filter((a) => a.specialistId === sp.id);
            const liveRevenue = sp.monthlyRevenue + assignedApts.reduce((s, a) => s + (a.price || 0), 0);
            const commissionPayout = Math.round(liveRevenue * (sp.commission / 100));

            return `
              <article class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col justify-between gap-5">
                <div class="flex flex-col gap-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <div class="w-12 h-12 rounded-full ${sp.avatarBg} font-display font-bold flex items-center justify-center text-headline-md">
                        ${sp.initials}
                      </div>
                      <div>
                        <h3 class="font-display text-headline-lg font-semibold text-on-surface">${sp.name}</h3>
                        <p class="text-body-sm text-primary font-medium">${sp.role}</p>
                      </div>
                    </div>
                    <button type="button" onclick="TurnosApp.openSpecialistModal('${sp.id}')" class="text-on-surface-variant hover:text-primary" title="Editar especialista">
                      <span class="material-symbols-outlined text-title-md">edit</span>
                    </button>
                  </div>

                  <div class="p-3.5 rounded-md bg-surface-container-low border border-outline-variant text-body-sm flex flex-col gap-2">
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant">Estado actual:</span>
                      <span class="font-semibold ${sp.status === 'active' ? 'text-success' : 'text-warning'}">${sp.statusLabel}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant">Horario habitual:</span>
                      <span class="font-semibold text-on-surface">${sp.schedule}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant">Turnos esta semana:</span>
                      <span class="font-bold text-primary">${assignedApts.length} turnos</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-on-surface-variant">Facturación mes:</span>
                      <span class="font-bold text-on-surface">${formatARS(liveRevenue)}</span>
                    </div>
                    <div class="flex justify-between border-t border-outline-variant/60 pt-1.5">
                      <span class="text-on-surface-variant">Comisión (${sp.commission}%):</span>
                      <span class="font-bold text-success">${formatARS(commissionPayout)}</span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2 pt-3 border-t border-outline-variant">
                  <button type="button" onclick="TurnosApp.setCalendarSpecialist('${sp.id}'); TurnosApp.setTab('calendar')" class="flex-1 py-2 bg-surface-container hover:bg-surface-variant text-on-surface rounded-md text-label-sm font-semibold border border-outline-variant">
                    Filtrar Agenda
                  </button>
                  <button type="button" onclick="TurnosApp.openNewAppointmentModal({ specialistId: '${sp.id}' })" class="flex-1 py-2 bg-primary text-white rounded-md text-label-sm font-semibold hover:opacity-95">
                    Asignar Turno
                  </button>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  }

  // Recordatorios WhatsApp Bot View (100% Funcional)
  function renderRemindersView() {
    const logs = state.business.whatsappBot.logs || [];
    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Automatización Concierge</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Recordatorios WhatsApp &amp; Plantillas</h1>
        </div>
        <span class="text-label-sm font-semibold bg-success-container text-on-success-container px-3 py-1.5 rounded-full flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-success"></span>
          WhatsApp Concierge Activo • ${state.business.whatsappBot.sentToday} enviados hoy
        </span>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <h3 class="font-display text-headline-lg font-semibold text-on-surface">Plantilla de Confirmación 24h Antes</h3>
              <button type="button" onclick="TurnosApp.saveWhatsAppTemplate()" class="text-label-sm text-primary font-semibold hover:underline">Guardar plantilla</button>
            </div>
            <p class="text-body-sm text-on-surface-variant">
              Edita el mensaje en tiempo real. Puedes usar las variables dinámicas: <code>{{nombre}}</code>, <code>{{servicio}}</code>, <code>{{especialista}}</code>, <code>{{fecha}}</code> y <code>{{hora}}</code>.
            </p>
            <textarea id="wa-template-input" oninput="TurnosApp.updateWhatsAppTemplateInput(this.value)" rows="4" class="w-full p-3.5 bg-surface-container-low border border-outline rounded-md text-body-sm text-on-surface font-body focus:border-primary">${state.business.whatsappBot.template24h}</textarea>

            <div class="flex items-center justify-between gap-3 pt-2 flex-wrap">
              <div class="flex items-center gap-2 text-body-sm">
                <span class="text-on-surface-variant">Probar con turno:</span>
                <select onchange="TurnosApp.setReminderPreviewApt(this.value)" class="px-2.5 py-1.5 bg-surface border border-outline rounded text-body-sm">
                  ${state.appointments
                    .slice(0, 8)
                    .map(
                      (a) =>
                        `<option value="${a.id}" ${a.id === ui.reminderPreviewAptId ? 'selected' : ''}>${a.clientName} (${a.time} hs)</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onclick="TurnosApp.sendWhatsAppReminder('${ui.reminderPreviewAptId}', false)" class="px-4 py-2 bg-primary text-white rounded-md font-label text-label-sm font-semibold hover:opacity-95">
                  Simular envío Bot
                </button>
                <button type="button" onclick="TurnosApp.sendWhatsAppReminder('${ui.reminderPreviewAptId}', true)" class="px-4 py-2 bg-success text-white rounded-md font-label text-label-sm font-semibold hover:opacity-95 flex items-center gap-1">
                  <span class="material-symbols-outlined text-body-sm">open_in_new</span>
                  Abrir WhatsApp Web
                </button>
              </div>
            </div>
          </section>

          <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
            <h3 class="font-display text-headline-lg font-semibold text-on-surface">Vista Previa en el Celular del Cliente</h3>
            <div class="bg-[#ECE5DD] p-5 rounded-lg border border-outline-variant flex flex-col gap-3">
              <div class="bg-white p-3.5 rounded-lg shadow-xs max-w-md text-body-sm text-on-surface">
                <p class="font-semibold text-primary text-[11px] mb-1">Studio Bellas • Concierge Oficial</p>
                <p id="wa-live-preview-text">${window.TurnosApp.getFormattedReminderPreview()}</p>
                <span class="block text-right text-[10px] text-on-surface-variant mt-1">09:30 ✓✓</span>
              </div>
              <div class="bg-[#DCF8C6] p-3 rounded-lg shadow-xs self-end text-body-sm text-on-surface">
                <p>SI, confirmo mi asistencia! Gracias ✨</p>
                <span class="block text-right text-[10px] text-on-surface-variant mt-1">09:32 ✓✓</span>
              </div>
            </div>
          </section>
        </div>

        <!-- Bitácora de Mensajes Enviados -->
        <section class="bg-surface rounded-lg border border-outline-variant shadow-sm overflow-hidden">
          <div class="p-5 border-b border-outline-variant flex items-center justify-between">
            <h3 class="font-display text-headline-lg font-semibold text-on-surface">Bitácora de Recordatorios Enviados Hoy</h3>
            <span class="text-label-sm text-on-surface-variant">${logs.length} registros recientes</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-body-sm">
              <thead>
                <tr class="border-b border-outline-variant bg-surface-container-low text-label-sm font-semibold text-on-surface-variant">
                  <th class="py-3 px-6">Hora</th>
                  <th class="py-3 px-4">Cliente</th>
                  <th class="py-3 px-4">WhatsApp</th>
                  <th class="py-3 px-4">Servicio</th>
                  <th class="py-3 px-6 text-right">Estado de Confirmación</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant">
                ${logs
                  .map(
                    (l) => `
                  <tr>
                    <td class="py-3 px-6 font-medium tabular-nums">${l.time} hs</td>
                    <td class="py-3 px-4 font-semibold text-on-surface">${l.clientName}</td>
                    <td class="py-3 px-4 text-on-surface-variant tabular-nums">${l.phone}</td>
                    <td class="py-3 px-4">${l.service}</td>
                    <td class="py-3 px-6 text-right">
                      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-semibold ${
                        l.status.includes('Esperando')
                          ? 'bg-warning-container text-on-warning-container'
                          : 'bg-success-container text-on-success-container'
                      }">${l.status}</span>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  // SCREEN 6: Estadísticas & Rendimiento — TurnosApp (100% Funcional)
  function renderAnalyticsView() {
    const mult = ui.analyticsPeriod === 'month' ? 0.85 : ui.analyticsPeriod === 'quarter' ? 2.9 : 1;
    const extraFromLive = state.appointments.reduce((acc, a) => acc + (a.price || 0), 0) - 434500;
    const totalRevenue = Math.round(5820000 * mult) + extraFromLive;
    const totalCompleted = Math.round(312 * mult) + (state.appointments.length - 21);
    const avgTicket = Math.round(totalRevenue / Math.max(1, totalCompleted));

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Análisis Comercial</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Métricas Reales &amp; Rentabilidad</h1>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1 bg-surface-container p-1 rounded-md border border-outline-variant">
            <button type="button" onclick="TurnosApp.setAnalyticsPeriod('month')" class="px-2.5 py-1 rounded text-label-sm ${
              ui.analyticsPeriod === 'month' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Este mes</button>
            <button type="button" onclick="TurnosApp.setAnalyticsPeriod('30d')" class="px-3 py-1 rounded text-label-sm ${
              ui.analyticsPeriod === '30d' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Últimos 30 días</button>
            <button type="button" onclick="TurnosApp.setAnalyticsPeriod('quarter')" class="px-2.5 py-1 rounded text-label-sm ${
              ui.analyticsPeriod === 'quarter' ? 'bg-surface text-primary font-semibold shadow-xs' : 'text-on-surface-variant hover:text-on-surface'
            }">Trimestre</button>
          </div>

          <button type="button" onclick="TurnosApp.exportAnalyticsReport()" class="inline-flex items-center gap-2 px-4 py-2 border border-outline bg-surface rounded-md font-label text-label-md hover:bg-surface-container transition-all">
            <span class="material-symbols-outlined text-title-md text-primary">download</span>
            <span>Exportar informe CSV</span>
          </button>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <section class="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Facturación 30 Días</span>
              <span class="material-symbols-outlined text-title-lg text-primary">payments</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${formatARS(totalRevenue)}</h2>
              <p class="text-body-sm text-success font-semibold mt-1 flex items-center gap-1">
                <span class="material-symbols-outlined text-label-sm">trending_up</span> +14.2% vs mes previo
              </p>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Turnos Completados</span>
              <span class="material-symbols-outlined text-title-lg text-primary">check_circle</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${totalCompleted} <span class="text-title-lg font-normal text-on-surface-variant font-body">citas</span></h2>
              <p class="text-body-sm text-on-surface-variant mt-1">
                98.4% tasa de asistencia
              </p>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Ticket Promedio</span>
              <span class="material-symbols-outlined text-title-lg text-secondary">receipt_long</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-on-surface tabular-nums">${formatARS(avgTicket)}</h2>
              <p class="text-body-sm text-primary font-medium mt-1">
                +8.5% por servicios combinados
              </p>
            </div>
          </article>

          <article class="bg-surface p-6 rounded-lg border border-outline-variant shadow-sm flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="font-label text-label-md text-on-surface-variant uppercase tracking-wider text-[11px]">Ausencias (No-Show)</span>
              <span class="material-symbols-outlined text-title-lg text-success">verified</span>
            </div>
            <div class="mt-4">
              <h2 class="font-display text-headline-xl text-success tabular-nums">1.6%</h2>
              <p class="text-body-sm text-on-surface-variant mt-1">
                Apenas 5 citas no asistidas
              </p>
            </div>
          </article>
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-2 flex flex-col gap-6">
            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-5">
              <div class="flex items-center justify-between border-b border-outline-variant pb-4">
                <div>
                  <h3 class="font-display text-headline-lg font-semibold text-on-surface">Servicios más Solicitados</h3>
                  <p class="font-body text-body-sm text-on-surface-variant mt-0.5">
                    Volumen de citas e ingresos generados por cada categoría.
                  </p>
                </div>
                <span class="text-label-sm font-semibold text-primary">Total ${totalCompleted} citas</span>
              </div>

              <div class="flex flex-col gap-4">
                ${state.services
                  .map((srv, idx) => {
                    const barColors = ['bg-primary', 'bg-secondary', 'bg-brand-roble', 'bg-outline'];
                    const count = Math.round((srv.monthlyBookings || 48) * mult);
                    const rev = count * srv.price;
                    const pct = Math.min(100, Math.max(12, Math.round((count / totalCompleted) * 100)));
                    return `
                      <div class="flex flex-col gap-1.5">
                        <div class="flex items-center justify-between text-body-sm">
                          <span class="font-semibold text-on-surface">${srv.name}</span>
                          <span class="tabular-nums font-bold text-on-surface">${count} reservas • ${formatARS(rev)}</span>
                        </div>
                        <div class="w-full bg-surface-container rounded-full h-2 overflow-hidden">
                          <div class="${barColors[idx % barColors.length]} h-2 rounded-full" style="width: ${pct}%"></div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </section>

            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <h3 class="font-display text-headline-lg font-semibold text-on-surface">Franjas Horarias con Mayor Demanda</h3>
                <span class="text-label-sm text-on-surface-variant font-medium">Patrón semanal</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div class="p-3.5 rounded-md bg-surface-container-low border border-outline-variant">
                  <span class="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider block">Horario Pico Mañana</span>
                  <span class="font-display text-headline-lg font-bold text-on-surface tabular-nums block mt-1">10:00 - 12:00</span>
                  <p class="text-body-sm text-primary font-medium mt-0.5">88% de ocupación</p>
                </div>

                <div class="p-3.5 rounded-md bg-primary-container/20 border border-primary/30">
                  <span class="text-label-sm font-semibold text-primary uppercase tracking-wider block">Horario Pico Tarde</span>
                  <span class="font-display text-headline-lg font-bold text-primary tabular-nums block mt-1">17:00 - 19:30</span>
                  <p class="text-body-sm text-on-surface font-semibold mt-0.5">96% de ocupación habitual</p>
                </div>

                <div class="p-3.5 rounded-md bg-surface-container-low border border-outline-variant">
                  <span class="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider block">Día más Solicitado</span>
                  <span class="font-display text-headline-lg font-bold text-on-surface block mt-1">Sábados</span>
                  <p class="text-body-sm text-success font-medium mt-0.5">Se llena 5 días antes</p>
                </div>
              </div>
            </section>
          </div>

          <div class="flex flex-col gap-6">
            <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex flex-col gap-5">
              <div class="flex items-center justify-between border-b border-outline-variant pb-3">
                <h3 class="font-display text-headline-md font-semibold text-on-surface">Rendimiento de Equipo</h3>
                <span class="text-label-sm text-primary font-semibold">${state.specialists.length} miembros</span>
              </div>

              <div class="flex flex-col gap-4">
                ${state.specialists
                  .map(
                    (sp) => `
                  <div class="p-3.5 rounded-md border border-outline-variant bg-surface-container-low flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-full ${sp.avatarBg} font-display font-semibold flex items-center justify-center text-label-sm">
                          ${sp.initials}
                        </div>
                        <div>
                          <p class="font-semibold text-on-surface text-body-sm">${sp.name}</p>
                          <p class="text-[11px] text-on-surface-variant">${sp.role}</p>
                        </div>
                      </div>
                      <span class="font-bold text-on-surface tabular-nums">${formatARS(Math.round(sp.monthlyRevenue * mult))}</span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-on-surface-variant pt-1 border-t border-outline-variant/60">
                      <span>${Math.round(sp.monthlyServices * mult)} servicios</span>
                      <span class="text-success font-semibold">${sp.rating} ★ (${sp.reviews} opiniones)</span>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>

              <div class="p-3 bg-surface-container rounded-md border border-outline-variant text-[11px] text-on-surface-variant leading-relaxed">
                <span class="font-semibold text-on-surface block mb-0.5">Sugerencia comercial:</span>
                Los turnos vespertinos de viernes y sábados tienen 96% de ocupación. Se sugiere habilitar un segundo turno de asistencia o extender 1 hora el cierre.
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  // SCREEN 7: Planes SaaS & Suscripción — TurnosApp (100% Funcional)
  function renderPlansView() {
    const currentPlan = state.business.plan;
    const planTitleMap = {
      FREE: 'TurnosApp FREE',
      PRO: 'TurnosApp PRO',
      BUSINESS: 'TurnosApp BUSINESS'
    };

    return `
      <header class="bg-surface border-b border-outline-variant px-8 py-5 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-4">
        <div>
          <span class="font-label text-label-sm text-primary uppercase tracking-widest block mb-0.5 font-semibold">Roble Studio SaaS</span>
          <h1 class="font-display text-display-lg text-on-surface italic">Planes &amp; Suscripción Comercial</h1>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-label-sm font-semibold bg-success-container text-on-success-container px-3 py-1 rounded-full flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-success"></span>
            Plan ${currentPlan} Activo • Facturación al día
          </span>
        </div>
      </header>

      <div class="p-8 flex flex-col gap-8">
        <section class="bg-surface rounded-lg border border-outline-variant p-6 shadow-sm flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center font-display font-bold text-headline-lg">
              ${currentPlan}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="font-display text-headline-lg font-semibold text-on-surface">Tu Plan Actual: ${planTitleMap[currentPlan]}</h2>
                <span class="text-[11px] font-semibold bg-primary text-white px-2 py-0.5 rounded">Recomendado</span>
              </div>
              <p class="font-body text-body-sm text-on-surface-variant mt-0.5">
                ${state.specialists.length} especialistas activos • Medio de pago: ${state.business.paymentMethod.brand} •••• ${state.business.paymentMethod.last4} • Renovación el 01 de Diciembre, 2026.
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button type="button" onclick="TurnosApp.openInvoicesModal()" class="px-4 py-2 border border-outline bg-surface rounded-md font-label text-label-md text-on-surface hover:bg-surface-container">
              Ver recibos &amp; facturas
            </button>
            <button type="button" onclick="TurnosApp.openPaymentMethodModal()" class="px-4 py-2 bg-primary text-white rounded-md font-label text-label-md font-semibold hover:opacity-95">
              Administrar método de pago
            </button>
          </div>
        </section>

        <section class="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          <!-- PLAN FREE -->
          <article class="bg-surface rounded-lg ${
            currentPlan === 'FREE' ? 'border-2 border-primary shadow-md' : 'border border-outline-variant shadow-sm'
          } p-7 flex flex-col justify-between relative">
            ${
              currentPlan === 'FREE'
                ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white font-label text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-xs">Tu Plan Actual</span>`
                : ''
            }
            <div>
              <span class="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Para Profesionales Solos</span>
              <h3 class="font-display text-headline-xl text-on-surface font-semibold mt-1">Plan Free</h3>
              <p class="text-body-sm text-on-surface-variant mt-1">
                Ideal para comenzar a ordenar tus reservas sin costo mensual fijo.
              </p>

              <div class="my-5 pb-5 border-b border-outline-variant">
                <span class="font-display text-headline-xl font-bold text-on-surface tabular-nums">$0</span>
                <span class="text-body-sm text-on-surface-variant">/ mes de por vida</span>
              </div>

              <ul class="flex flex-col gap-2.5 text-body-sm text-on-surface">
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span><strong>1 profesional</strong> habilitado</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Hasta <strong>30 reservas</strong> mensuales</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Gestión básica de agenda diaria</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Página web pública de reservas</span></li>
                <li class="flex items-center gap-2 text-on-surface-variant line-through opacity-70"><span class="material-symbols-outlined text-body-md text-on-surface-variant">close</span><span>Recordatorios automáticos WhatsApp</span></li>
                <li class="flex items-center gap-2 text-on-surface-variant line-through opacity-70"><span class="material-symbols-outlined text-body-md text-on-surface-variant">close</span><span>Métricas y reportes de facturación</span></li>
              </ul>
            </div>

            <div class="pt-6 mt-6 border-t border-outline-variant">
              <button type="button" onclick="TurnosApp.selectPlan('FREE')" class="w-full py-2.5 ${
                currentPlan === 'FREE'
                  ? 'bg-primary-container text-on-primary-container font-bold'
                  : 'border border-outline text-on-surface hover:bg-surface-container font-semibold'
              } rounded-md font-label text-label-md transition-all">
                ${currentPlan === 'FREE' ? 'Suscripción Activa' : 'Cambiar a Plan Básico'}
              </button>
            </div>
          </article>

          <!-- PLAN PRO -->
          <article class="bg-surface rounded-lg ${
            currentPlan === 'PRO' ? 'border-2 border-primary shadow-md' : 'border border-outline-variant shadow-sm'
          } p-7 flex flex-col justify-between relative">
            ${
              currentPlan === 'PRO'
                ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white font-label text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-xs">Tu Plan Actual</span>`
                : ''
            }
            <div>
              <span class="text-label-sm font-semibold uppercase tracking-wider text-primary">Salones &amp; Ateliers en Crecimiento</span>
              <h3 class="font-display text-headline-xl text-on-surface font-semibold mt-1">Plan Pro</h3>
              <p class="text-body-sm text-on-surface-variant mt-1">
                La suite completa para negocios con equipo que buscan cero ausencias.
              </p>

              <div class="my-5 pb-5 border-b border-outline-variant">
                <span class="font-display text-headline-xl font-bold text-primary tabular-nums">$29.900</span>
                <span class="text-body-sm text-on-surface-variant">/ mes</span>
              </div>

              <ul class="flex flex-col gap-2.5 text-body-sm text-on-surface">
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Hasta <strong>5 profesionales</strong> en equipo</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span><strong>Reservas ilimitadas</strong> sin tope mensual</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span><strong>WhatsApp Concierge Bot</strong> (recordatorios 24h)</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Estadísticas de facturación y ocupación</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Personalización de marca, logo y colores</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>CRM con notas confidenciales de clientes</span></li>
              </ul>
            </div>

            <div class="pt-6 mt-6 border-t border-outline-variant">
              <button type="button" onclick="TurnosApp.selectPlan('PRO')" class="w-full py-2.5 ${
                currentPlan === 'PRO'
                  ? 'bg-primary-container text-on-primary-container font-bold'
                  : 'bg-primary text-white font-semibold hover:opacity-95'
              } rounded-md font-label text-label-md transition-all text-center">
                ${currentPlan === 'PRO' ? 'Suscripción Activa' : 'Activar Plan Pro'}
              </button>
            </div>
          </article>

          <!-- PLAN BUSINESS -->
          <article class="bg-surface rounded-lg ${
            currentPlan === 'BUSINESS' ? 'border-2 border-primary shadow-md' : 'border border-outline-variant shadow-sm'
          } p-7 flex flex-col justify-between relative">
            ${
              currentPlan === 'BUSINESS'
                ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white font-label text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-xs">Tu Plan Actual</span>`
                : ''
            }
            <div>
              <span class="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">Múltiples Sucursales &amp; Franquicias</span>
              <h3 class="font-display text-headline-xl text-on-surface font-semibold mt-1">Plan Business</h3>
              <p class="text-body-sm text-on-surface-variant mt-1">
                Para centros de gran escala con automatizaciones avanzadas y multi-sede.
              </p>

              <div class="my-5 pb-5 border-b border-outline-variant">
                <span class="font-display text-headline-xl font-bold text-on-surface tabular-nums">$58.000</span>
                <span class="text-body-sm text-on-surface-variant">/ mes</span>
              </div>

              <ul class="flex flex-col gap-2.5 text-body-sm text-on-surface">
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span><strong>Todas las funciones PRO</strong> incluidas</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span><strong>Profesionales ilimitados</strong></span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Multi-sede / sucursales unificadas</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Conexión directa WhatsApp Business API</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Roles y permisos jerárquicos por usuario</span></li>
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-body-md text-primary">check</span><span>Soporte prioritario 24/7 por Roble Studio</span></li>
              </ul>
            </div>

            <div class="pt-6 mt-6 border-t border-outline-variant">
              <button type="button" onclick="TurnosApp.selectPlan('BUSINESS')" class="w-full py-2.5 ${
                currentPlan === 'BUSINESS'
                  ? 'bg-primary-container text-on-primary-container font-bold'
                  : 'bg-primary text-white font-semibold hover:opacity-95'
              } rounded-md font-label text-label-md transition-all">
                ${currentPlan === 'BUSINESS' ? 'Suscripción Activa' : 'Actualizar a Business'}
              </button>
            </div>
          </article>
        </section>

        <section class="bg-surface-container-low border border-outline-variant p-6 rounded-lg flex items-center justify-between flex-wrap gap-4 text-body-sm">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-headline-md text-primary">security</span>
            <div>
              <p class="font-semibold text-on-surface">Arquitectura Multinquilino con Aislamiento Total de Datos</p>
              <p class="text-on-surface-variant">
                Cada negocio opera en su propio espacio independiente protegido con políticas RLS de Supabase y PostgreSQL.
              </p>
            </div>
          </div>
          <span class="text-label-sm font-semibold text-on-surface-variant">Producto oficial de Roble Studio</span>
        </section>
      </div>
    `;
  }

  // SCREEN 2: Reserva Pública — Studio Bellas (100% Funcional con detección real de conflictos)
  function renderPublicBookingView() {
    const pb = ui.publicBooking;
    const selectedService = state.services.find((s) => s.id === pb.serviceId) || state.services[0];
    const selectedDay = PUBLIC_DAYS[pb.dayIndex] || PUBLIC_DAYS[0];
    const displayPrice = selectedService.publicPrice || selectedService.price;

    if (pb.confirmedReceipt) {
      const r = pb.confirmedReceipt;
      const waText = `Hola Studio Bellas! Acabo de reservar mi turno #${r.code} para ${r.serviceName} el ${r.dayLabel} a las ${r.time} hs con ${r.specialistName}. Mi nombre es ${r.clientName}.`;
      return `
        <div class="min-h-screen bg-background pb-16 pt-6 px-4">
          <div class="max-w-md mx-auto bg-surface rounded-xl shadow-2xl border border-outline-variant overflow-hidden">
            <header class="bg-brand-roble text-white p-6 text-center">
              <div class="w-12 h-12 rounded-full bg-success text-white flex items-center justify-center mx-auto mb-3 shadow-md">
                <span class="material-symbols-outlined text-headline-lg">check</span>
              </div>
              <span class="font-label text-[11px] uppercase tracking-widest text-accent font-semibold">Reserva Confirmada • #${r.code}</span>
              <h1 class="font-display text-display-lg-mobile italic text-white mt-1">¡Te esperamos, ${r.clientName.split(' ')[0]}!</h1>
              <p class="text-body-sm text-outline mt-1">Enviamos el comprobante a tu WhatsApp (${r.phone})</p>
            </header>

            <div class="p-6 flex flex-col gap-4 text-body-sm">
              <div class="bg-surface-container-low p-4 rounded-lg border border-outline-variant flex flex-col gap-2.5">
                <div class="flex justify-between border-b border-outline-variant pb-2">
                  <span class="text-on-surface-variant">Tratamiento:</span>
                  <span class="font-semibold text-on-surface text-right">${r.serviceName}</span>
                </div>
                <div class="flex justify-between border-b border-outline-variant pb-2">
                  <span class="text-on-surface-variant">Especialista:</span>
                  <span class="font-semibold text-primary">${r.specialistName}</span>
                </div>
                <div class="flex justify-between border-b border-outline-variant pb-2">
                  <span class="text-on-surface-variant">Fecha y Hora:</span>
                  <span class="font-bold text-on-surface">${r.dayLabel} • ${r.time} hs (${r.duration} min)</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-on-surface-variant">Inversión del servicio:</span>
                  <span class="font-bold text-primary text-title-md">${formatARS(r.price)}</span>
                </div>
              </div>

              <div class="flex flex-col gap-2.5 pt-2">
                <a href="https://wa.me/${r.phoneClean}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener" class="w-full py-3 bg-success text-white rounded-md font-label text-label-lg font-semibold flex items-center justify-center gap-2 shadow-sm hover:opacity-95">
                  <span class="material-symbols-outlined text-title-md">chat</span>
                  Recibir comprobante en WhatsApp
                </a>
                <button type="button" onclick="TurnosApp.setDashboardDate('${r.date}'); TurnosApp.setTab('dashboard')" class="w-full py-3 bg-primary text-white rounded-md font-label text-label-lg font-semibold flex items-center justify-center gap-2 shadow-sm hover:opacity-95">
                  <span class="material-symbols-outlined text-title-md">dashboard</span>
                  Ver turno en Panel Admin
                </button>
                <button type="button" onclick="TurnosApp.resetPublicBooking()" class="w-full py-2.5 border border-outline rounded-md font-label text-label-md text-on-surface hover:bg-surface-container">
                  Realizar otra reserva
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const allSlotsForPublic = [...PUBLIC_MORNING_SLOTS, ...PUBLIC_AFTERNOON_SLOTS];

    return `
      <div class="bg-background text-on-surface font-body antialiased min-h-screen pb-16">
        <div class="max-w-md mx-auto bg-surface min-h-screen shadow-xl border-x border-outline-variant flex flex-col justify-between">
          <div>
            <!-- Elegant Atelier Header & Identity -->
            <header class="bg-brand-roble text-white p-6 pb-7 relative overflow-hidden">
              <div class="relative z-10 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <span class="font-label text-[11px] uppercase tracking-widest text-outline-variant font-semibold flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-accent inline-block"></span>
                    Atelier &amp; Spa • TurnosApp
                  </span>
                  <span class="text-label-sm font-semibold text-white/90 bg-white/10 px-2.5 py-0.5 rounded-full">
                    Turnos abiertos
                  </span>
                </div>

                <div>
                  <h1 class="font-display text-display-lg italic text-white leading-tight font-medium">
                    ${state.business.name}
                  </h1>
                  <p class="font-body text-body-sm text-outline mt-1 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-body-sm text-white">location_on</span>
                    ${state.business.address}
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between mt-6 pt-5 border-t border-outline-variant/30 relative z-10">
                <div class="flex items-center gap-1.5 font-label text-label-sm">
                  <span class="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center font-bold text-[10px]">1</span>
                  <span class="text-white font-medium">Servicio</span>
                </div>
                <div class="w-8 h-px bg-primary"></div>
                <div class="flex items-center gap-1.5 font-label text-label-sm">
                  <span class="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center font-bold text-[10px]">2</span>
                  <span class="text-white font-medium">Horario</span>
                </div>
                <div class="w-8 h-px bg-primary"></div>
                <div class="flex items-center gap-1.5 text-white font-label text-label-sm">
                  <span class="w-5 h-5 rounded-full bg-accent text-brand-roble flex items-center justify-center font-bold text-[10px]">3</span>
                  <span>Confirmación</span>
                </div>
              </div>
            </header>

            <main class="p-6 flex flex-col gap-7">
              <!-- Paso 1: Selección de Servicio -->
              <section class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between border-b border-outline-variant pb-2">
                  <h2 class="font-display text-headline-xl text-on-surface font-semibold">1. Selecciona tu tratamiento</h2>
                  <span class="font-label text-label-sm text-on-surface-variant font-medium">${state.services.length} opciones</span>
                </div>

                <div class="flex flex-col gap-3">
                  ${state.services
                    .map((srv) => {
                      const isChecked = pb.serviceId === srv.id;
                      const cardClass = isChecked
                        ? 'border-2 border-primary bg-primary-container/20 shadow-xs'
                        : 'border border-outline-variant bg-surface hover:border-primary/50';
                      const priceToShow = srv.publicPrice || srv.price;
                      return `
                        <label onclick="TurnosApp.selectPublicService('${srv.id}')" class="p-4 rounded-lg ${cardClass} flex items-center justify-between cursor-pointer transition-all duration-state-change">
                          <div class="flex items-center gap-3">
                            <input type="radio" name="service" ${isChecked ? 'checked' : ''} class="text-primary focus:ring-primary h-4 w-4">
                            <div>
                              <h3 class="font-body text-title-md text-on-surface font-semibold">${srv.name}</h3>
                              <p class="font-body text-body-sm text-on-surface-variant mt-0.5">${srv.publicDescription || srv.description}</p>
                              <div class="flex items-center gap-3 mt-2 text-label-sm text-on-surface-variant">
                                <span class="flex items-center gap-1 ${isChecked ? 'font-semibold text-primary' : 'font-medium text-on-surface-variant'}">
                                  <span class="material-symbols-outlined text-body-sm">schedule</span> ${srv.duration} minutos
                                </span>
                                <span>•</span>
                                <span class="${isChecked ? 'text-primary font-medium' : ''}">Atención personalizada</span>
                              </div>
                            </div>
                          </div>
                          <span class="font-body text-title-md font-bold ${isChecked ? 'text-primary' : 'text-on-surface'} tabular-nums shrink-0 ml-2">${formatARS(priceToShow)}</span>
                        </label>
                      `;
                    })
                    .join('')}
                </div>
              </section>

              <!-- Paso 2: Selección de Especialista -->
              <section class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between border-b border-outline-variant pb-2">
                  <h2 class="font-display text-headline-xl text-on-surface font-semibold">2. Tu Especialista</h2>
                  <span class="text-label-sm text-primary font-medium">Atención experta</span>
                </div>
                
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div onclick="TurnosApp.selectPublicSpecialist('any')" class="flex flex-col items-center p-2.5 rounded-lg ${
                    pb.specialistId === 'any'
                      ? 'border-2 border-primary bg-primary-container/20'
                      : 'border border-outline-variant bg-surface hover:border-primary/50'
                  } cursor-pointer text-center transition-all">
                    <div class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-bold mb-1 shadow-xs">
                      <span class="material-symbols-outlined text-title-md text-white">auto_awesome</span>
                    </div>
                    <span class="font-body text-label-sm text-on-surface font-semibold">Primer turno</span>
                    <span class="text-body-sm text-primary text-[10px] font-medium">Más rápido</span>
                  </div>

                  ${state.specialists
                    .map((sp) => {
                      const active = pb.specialistId === sp.id;
                      return `
                        <div onclick="TurnosApp.selectPublicSpecialist('${sp.id}')" class="flex flex-col items-center p-2.5 rounded-lg ${
                          active
                            ? 'border-2 border-primary bg-primary-container/20'
                            : 'border border-outline-variant bg-surface hover:border-primary/50'
                        } cursor-pointer text-center transition-all">
                          <div class="w-9 h-9 rounded-full bg-surface-container text-on-surface font-display font-bold flex items-center justify-center mb-1 text-label-sm border border-outline-variant">
                            ${sp.initials}
                          </div>
                          <span class="font-body text-label-sm text-on-surface font-semibold">${sp.shortName}</span>
                          <span class="text-body-sm text-on-surface-variant text-[10px] truncate w-full">${sp.role}</span>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </section>

              <!-- Paso 3: Selección de Fecha y Franja Horaria -->
              <section class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between border-b border-outline-variant pb-2">
                  <h2 class="font-display text-headline-xl text-on-surface font-semibold">3. Fecha &amp; Horario</h2>
                  <span class="font-label text-label-sm text-primary font-semibold">Noviembre 2026</span>
                </div>

                <div class="flex items-center gap-2 overflow-x-auto pb-1">
                  ${PUBLIC_DAYS.map((d, idx) => {
                    const isSel = pb.dayIndex === idx;
                    return `
                      <div onclick="TurnosApp.selectPublicDay(${idx})" class="flex flex-col items-center justify-center min-w-[56px] py-2.5 rounded-lg ${
                        isSel
                          ? 'border-2 border-primary bg-primary text-white shadow-sm'
                          : 'border border-outline-variant bg-surface hover:border-primary'
                      } cursor-pointer transition-all">
                        <span class="text-label-sm uppercase font-semibold ${isSel ? 'text-white' : 'text-on-surface-variant'}">${d.label}</span>
                        <span class="font-display text-headline-lg font-bold tabular-nums ${isSel ? 'text-white' : 'text-on-surface'}">${d.num}</span>
                      </div>
                    `;
                  }).join('')}
                </div>

                <!-- Slots de Horarios Libres con detección de ocupados -->
                <div class="mt-2 bg-surface p-4 rounded-lg border border-outline-variant">
                  <p class="font-label text-label-sm text-on-surface-variant mb-2.5 font-medium">Horarios en tiempo real (${selectedDay.shortLabel}):</p>
                  <div class="grid grid-cols-3 gap-2.5">
                    ${allSlotsForPublic
                      .map((slot) => {
                        const occupied = isSlotOccupied(selectedDay.date, slot, pb.specialistId);
                        const isSel = pb.time === slot && !occupied;
                        if (occupied) {
                          return `
                            <button type="button" disabled class="py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface-variant/50 font-label text-label-sm line-through cursor-not-allowed" title="Horario ya reservado">
                              ${slot} (Ocup.)
                            </button>
                          `;
                        }
                        return `
                          <button type="button" onclick="TurnosApp.selectPublicTime('${slot}')" class="py-2.5 rounded-md ${
                            isSel
                              ? 'border-2 border-primary bg-primary text-white font-bold shadow-sm'
                              : 'border border-outline-variant bg-surface text-on-surface hover:border-primary'
                          } font-label text-label-md tabular-nums transition-all">
                            ${slot}
                          </button>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
              </section>

              <!-- Paso 4: Datos del Cliente -->
              <section class="flex flex-col gap-3.5 pt-4 border-t border-outline-variant">
                <div class="flex items-center justify-between border-b border-outline-variant pb-2">
                  <h2 class="font-display text-headline-xl text-on-surface font-semibold">4. Tus Datos</h2>
                  <span class="text-label-sm text-on-surface-variant">Confidencial</span>
                </div>
                
                <div class="flex flex-col gap-3">
                  <div>
                    <label class="font-label text-label-sm text-on-surface block mb-1">Nombre completo *</label>
                    <input type="text" placeholder="Ej: Laura Benítez" value="${pb.clientName}" oninput="TurnosApp.updatePublicField('clientName', this.value)" class="w-full px-3.5 py-2.5 bg-surface border border-outline rounded-md text-on-surface text-body-md focus:border-primary focus:ring-1 focus:ring-primary">
                  </div>

                  <div>
                    <label class="font-label text-label-sm text-on-surface block mb-1">WhatsApp para confirmación *</label>
                    <div class="relative flex items-center">
                      <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-body-md">phone</span>
                      <input type="tel" placeholder="+54 9 11 ..." value="${pb.clientPhone}" oninput="TurnosApp.updatePublicField('clientPhone', this.value)" class="w-full pl-10 pr-3.5 py-2.5 bg-surface border border-outline rounded-md text-on-surface text-body-md focus:border-primary focus:ring-1 focus:ring-primary">
                    </div>
                    <span class="font-body text-body-sm text-on-surface-variant mt-1 block">Te enviaremos los detalles y recordatorio directo a tu WhatsApp.</span>
                  </div>
                </div>
              </section>
            </main>
          </div>

          <div class="p-5 bg-surface border-t border-outline-variant sticky bottom-0 shadow-2xl flex flex-col gap-2.5 z-20">
            <div class="flex items-center justify-between text-body-sm">
              <span class="text-on-surface-variant">Inversión del servicio:</span>
              <span class="font-body text-title-lg font-bold text-primary tabular-nums">${formatARS(displayPrice)}</span>
            </div>
            <button type="button" onclick="TurnosApp.confirmPublicBooking()" class="w-full py-3.5 bg-primary text-on-primary rounded-md font-label text-label-lg font-semibold shadow-sm hover:opacity-95 active:scale-95 transition-all duration-state-change flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-title-lg text-white">check_circle</span>
              <span>Confirmar Cita (${selectedDay.label} ${pb.time} hs)</span>
            </button>
            <p class="text-center text-[11px] text-on-surface-variant">
              Política de cancelación flexible ${state.business.policies.cancelLimit.toLowerCase()} • Desarrollado por <span class="font-semibold text-on-surface">TurnosApp</span>
            </p>
          </div>
        </div>
      </div>
    `;
  }

  function renderFloatingSwitcher() {
    if (ui.mode === 'public') {
      return `
        <div class="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-brand-roble text-white px-4 py-2.5 rounded-full shadow-2xl border border-accent/60">
          <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
          <span class="text-label-sm font-medium hidden sm:inline">Vista Cliente (Mobile)</span>
          <button type="button" onclick="TurnosApp.setMode('admin')" class="ml-1 px-3 py-1 bg-primary text-white rounded-full text-label-sm font-semibold hover:bg-accent hover:text-brand-roble transition-all flex items-center gap-1">
            <span class="material-symbols-outlined text-body-sm">admin_panel_settings</span>
            Volver al Panel Admin
          </button>
        </div>
      `;
    }

    return `
      <div class="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-brand-roble text-white px-3.5 py-2 rounded-full shadow-2xl border border-outline-variant/40">
        <button type="button" onclick="TurnosApp.setMode('public')" class="flex items-center gap-1.5 text-label-sm font-semibold text-white hover:text-accent transition-all" title="Probar la experiencia móvil de reserva pública">
          <span class="material-symbols-outlined text-title-md text-accent">smartphone</span>
          <span>Probar Reserva Pública</span>
        </button>
      </div>
    `;
  }

  function render() {
    const appRoot = document.getElementById('app-root');
    if (!appRoot) return;

    if (ui.mode === 'public') {
      appRoot.innerHTML = renderPublicBookingView() + renderFloatingSwitcher();
      return;
    }

    let mainViewHtml = '';
    switch (ui.tab) {
      case 'dashboard':
        mainViewHtml = renderDashboardView();
        break;
      case 'calendar':
        mainViewHtml = renderCalendarView();
        break;
      case 'clients':
        mainViewHtml = renderClientsView();
        break;
      case 'services':
        mainViewHtml = renderServicesView();
        break;
      case 'specialists':
        mainViewHtml = renderSpecialistsView();
        break;
      case 'reminders':
        mainViewHtml = renderRemindersView();
        break;
      case 'analytics':
        mainViewHtml = renderAnalyticsView();
        break;
      case 'plans':
        mainViewHtml = renderPlansView();
        break;
      default:
        mainViewHtml = renderDashboardView();
    }

    appRoot.innerHTML = `
      <div class="flex min-h-screen">
        ${renderSidebar()}
        <main class="flex-1 flex flex-col overflow-y-auto min-h-screen">
          ${mainViewHtml}
        </main>
      </div>
      ${renderFloatingSwitcher()}
    `;
  }

  window.addEventListener('DOMContentLoaded', initState);
})();
