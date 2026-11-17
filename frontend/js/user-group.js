(function () {
  'use strict';

  var API_BASE = '/api/admin';

  var ADMIN_PAGE = 'administrator.html';
  var GROUPS_PAGE = 'manage-users.html#groups';

  function parseJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, data: data };
    });
  }

  function request(method, path, body) {
    var options = {
      method: method,
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(API_BASE + path, options).then(parseJson);
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  function people(count) {
    return count + (count === 1 ? ' person' : ' people');
  }

  function fullName(user) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var groupId = new URLSearchParams(window.location.search).get('id');
    var panels = Array.prototype.slice.call(document.querySelectorAll('.admin-panel'));
    var myPermissions = [];
    var group = null;

    function can(permission) {
      return myPermissions.indexOf(permission) !== -1;
    }

    function showPanel(panelId) {
      panels.forEach(function (panel) { panel.hidden = panel.id !== panelId; });
    }

    function goToLogin() {
      window.location.replace(ADMIN_PAGE);
    }

    function handleApiFailure(result) {
      if (result.status === 401) {
        goToLogin();
        return true;
      }
      if (result.status === 403) {
        var reason = result.data && result.data.reason;
        if (reason === 'missing_permission' || reason === 'no_permission_group') {
          showToast((result.data && result.data.error) || 'You do not have permission to do this.', 'error');
          return true;
        }
        goToLogin();
        return true;
      }
      return false;
    }

    var openModal = null;

    function closeModal() {
      if (!openModal) return;
      openModal.hidden = true;
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      openModal = null;
    }

    function showModal(modalId) {
      closeModal();
      var modal = document.getElementById(modalId);
      if (!modal) return;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      openModal = modal;
    }

    Array.prototype.forEach.call(document.querySelectorAll('.admin-modal [data-modal-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });

    var logoutButtons = [
      document.getElementById('admin-logout-btn'),
      document.getElementById('admin-logout-btn-mobile')
    ].filter(Boolean);

    logoutButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        logoutButtons.forEach(function (b) { b.disabled = true; });
        request('POST', '/logout')
          .catch(function (err) { console.error('[user-group] logout failed:', err); })
          .finally(goToLogin);
      });
    });

    var toastContainer = document.getElementById('toast-container');

    function showToast(message, type) {
      if (!toastContainer) return;
      var toast = document.createElement('div');
      toast.className = 'toast' + (type === 'success' ? ' is-success' : '');
      toast.textContent = message;
      toastContainer.appendChild(toast);
      requestAnimationFrame(function () { toast.classList.add('is-visible'); });

      var dismissed = false;
      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        toast.classList.remove('is-visible');
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
      }
      toast.addEventListener('click', dismiss);
      setTimeout(dismiss, 5000);
    }

    function setFormStatus(el, message, type) {
      el.textContent = message;
      el.classList.remove('is-success', 'is-error');
      el.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearFormStatus(el) {
      el.classList.remove('is-visible', 'is-success', 'is-error');
      el.textContent = '';
    }

    function setListMessage(el, message) {
      el.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'onboardings-message';
      p.textContent = message;
      el.appendChild(p);
    }

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.admin-tab[data-tab]'));
    var tabPanels = Array.prototype.slice.call(document.querySelectorAll('.admin-tab-panel[data-tab-panel]'));

    function selectTab(name) {
      tabs.forEach(function (tab) {
        var active = tab.dataset.tab === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      tabPanels.forEach(function (panel) { panel.hidden = panel.dataset.tabPanel !== name; });
      if (name === 'emails') loadEmails();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    });

    var composer = window.NKSEmailComposer.create({
      apiBase: API_BASE,
      showModal: showModal,
      closeModal: closeModal,
      showToast: showToast,
      setFormStatus: setFormStatus,
      clearFormStatus: clearFormStatus,
      handleApiFailure: handleApiFailure,
      parseJson: parseJson
    });

    var nameEl = document.getElementById('gp-name');
    var descriptionEl = document.getElementById('gp-description');
    var metaEl = document.getElementById('gp-meta');
    var actionsEl = document.getElementById('gp-actions');
    var membersList = document.getElementById('gp-members-list');
    var memberSearch = document.getElementById('gp-member-search');
    var addMembersBtn = document.getElementById('gp-add-members-btn');
    var emailsList = document.getElementById('gp-emails-list');
    var emailsTab = document.getElementById('gp-tab-emails');

    function renderHeader() {
      document.title = group.name + ' - NK Securities Research';
      nameEl.textContent = group.name;
      descriptionEl.textContent = group.description || '';
      descriptionEl.hidden = !group.description;
      metaEl.textContent = [
        plural(group.members.length, 'member'),
        group.createdAt ? 'Created ' + new Date(group.createdAt).toLocaleDateString() : '',
        group.createdBy ? 'by ' + group.createdBy.name : ''
      ].filter(Boolean).join(' · ').replace(' · by ', ' by ');
    }

    function requireMembers() {
      if (group.members.length) return true;
      showToast('This group has no members yet. Add some first.', 'error');
      return false;
    }

    function emailGroup(kind) {
      if (!requireMembers()) return;
      var combined = kind === 'combined';
      composer.open({
        kind: kind,
        users: group.members,
        url: API_BASE + '/user-groups/' + encodeURIComponent(group.id) + '/send-email',
        payload: { mode: kind },
        heading: combined ? 'Email Whole Group' : 'Email Each Member',
        description: combined
          ? 'One email to all ' + plural(group.members.length, 'member') + ' of "' + group.name + '". Choose below whether they can see each other\'s addresses.'
          : 'Each of the ' + plural(group.members.length, 'member') + ' of "' + group.name + '" gets their own separate email. Use Personalize to add their name.',
        onSent: function () { if (!tabPanels[1].hidden) loadEmails(); }
      });
    }

    function renderActions() {
      actionsEl.innerHTML = '';
      var items = [];

      if (can('email_users')) {
        items.push({ label: 'Email whole group (one combined email)', onSelect: function () { emailGroup('combined'); } });
        items.push({ label: 'Email each member separately', onSelect: function () { emailGroup('separate'); } });
      }
      if (can('manage_users')) {
        items.push({ label: 'Add members', onSelect: openAddMembers });
        items.push({ label: 'Edit name and description', onSelect: openEdit });
        items.push({ label: 'Delete group', danger: true, onSelect: deleteGroup });
      }
      if (!items.length) return;

      var menu = window.NKSRowMenu.build(items);
      var button = menu.querySelector('.row-menu-btn');
      button.classList.add('group-actions-btn');
      button.textContent = 'Actions';
      button.setAttribute('aria-label', 'Group actions');
      actionsEl.appendChild(menu);
    }

    function renderMemberRow(user) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';
      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = fullName(user) || user.email;
      info.appendChild(name);
      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = [user.email, user.createdAt ? 'Added ' + new Date(user.createdAt).toLocaleDateString() : '']
        .filter(Boolean).join(' · ');
      info.appendChild(meta);
      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';
      if (user.isAdmin) {
        var badge = document.createElement('span');
        badge.className = 'user-badge is-admin';
        badge.textContent = 'Admin';
        actions.appendChild(badge);
      }
      if (can('manage_users')) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'onboarding-row-btn is-danger';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove ' + (fullName(user) || user.email) + ' from the group');
        remove.addEventListener('click', function () { removeMember(user, remove); });
        actions.appendChild(remove);
      }
      row.appendChild(actions);
      return row;
    }

    function renderMembers() {
      var term = memberSearch.value.trim().toLowerCase();
      var shown = group.members.filter(function (user) {
        return !term || (fullName(user) + ' ' + user.email).toLowerCase().indexOf(term) !== -1;
      });

      membersList.innerHTML = '';
      if (!shown.length) {
        setListMessage(membersList, group.members.length
          ? 'No members match your search.'
          : (can('manage_users') ? 'No members yet. Use "Add members" to add people.' : 'No members yet.'));
        return;
      }
      shown.forEach(function (user) { membersList.appendChild(renderMemberRow(user)); });
    }

    memberSearch.addEventListener('input', renderMembers);

    function removeMember(user, btn) {
      var label = fullName(user) || user.email;
      if (!window.confirm('Remove ' + label + ' from "' + group.name + '"? Their account is not affected.')) return;

      btn.disabled = true;
      btn.textContent = 'Removing…';
      request('DELETE', '/user-groups/' + encodeURIComponent(group.id) + '/members/' + encodeURIComponent(user.id))
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status === 200) {
            showToast('Removed ' + label + ' from the group.', 'success');
            loadGroup();
            return;
          }
          showToast((result.data && result.data.error) || 'Could not remove that member.', 'error');
          btn.disabled = false;
          btn.textContent = 'Remove';
        })
        .catch(function (err) {
          console.error('[user-group] remove member failed:', err);
          showToast('Could not remove that member.', 'error');
          btn.disabled = false;
          btn.textContent = 'Remove';
        });
    }

    var addList = document.getElementById('gp-add-list');
    var addSearch = document.getElementById('gp-add-search');
    var addSince = document.getElementById('gp-add-since');
    var addSelectAll = document.getElementById('gp-add-select-all');
    var addCount = document.getElementById('gp-add-count');
    var addSubmit = document.getElementById('gp-add-submit');
    var candidates = [];
    var shownCandidates = [];
    var chosen = {};

    function updateAddSelection() {
      var count = Object.keys(chosen).length;
      var shownChosen = shownCandidates.filter(function (user) { return chosen[user.id]; }).length;
      addCount.textContent = count ? count + ' selected' : 'None selected';
      addSubmit.disabled = !count;
      addSubmit.textContent = count ? 'Add ' + count + ' to group' : 'Add to group';
      addSelectAll.disabled = !shownCandidates.length;
      addSelectAll.checked = shownCandidates.length > 0 && shownChosen === shownCandidates.length;
      addSelectAll.indeterminate = shownChosen > 0 && shownChosen < shownCandidates.length;
    }

    function renderCandidates() {
      var term = addSearch.value.trim().toLowerCase();
      var since = addSince.value ? new Date(addSince.value + 'T00:00:00') : null;
      shownCandidates = candidates.filter(function (user) {
        if (since && !(user.createdAt && new Date(user.createdAt) >= since)) return false;
        return !term || (fullName(user) + ' ' + user.email).toLowerCase().indexOf(term) !== -1;
      });

      addList.innerHTML = '';
      if (!shownCandidates.length) {
        setListMessage(addList, candidates.length ? 'No one matches your search.' : 'Everyone is already in this group.');
      }
      shownCandidates.forEach(function (user) {
        var row = document.createElement('label');
        row.className = 'onboarding-row is-clickable' + (chosen[user.id] ? ' is-selected' : '');

        var main = document.createElement('div');
        main.className = 'user-row-main';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'user-select';
        box.checked = !!chosen[user.id];
        box.addEventListener('change', function () {
          if (box.checked) chosen[user.id] = user;
          else delete chosen[user.id];
          row.classList.toggle('is-selected', box.checked);
          updateAddSelection();
        });
        main.appendChild(box);

        var info = document.createElement('div');
        info.className = 'onboarding-row-info';
        var name = document.createElement('div');
        name.className = 'onboarding-row-name';
        name.textContent = fullName(user) || user.email;
        info.appendChild(name);
        var meta = document.createElement('div');
        meta.className = 'onboarding-row-meta';
        meta.textContent = [user.email, user.createdAt ? 'Added ' + new Date(user.createdAt).toLocaleDateString() : '']
          .filter(Boolean).join(' · ');
        info.appendChild(meta);
        main.appendChild(info);
        row.appendChild(main);
        addList.appendChild(row);
      });
      updateAddSelection();
    }

    addSearch.addEventListener('input', renderCandidates);
    addSince.addEventListener('change', renderCandidates);

    addSelectAll.addEventListener('change', function () {
      shownCandidates.forEach(function (user) {
        if (addSelectAll.checked) chosen[user.id] = user;
        else delete chosen[user.id];
      });
      renderCandidates();
    });

    function openAddMembers() {
      chosen = {};
      candidates = [];
      addSearch.value = '';
      addSince.value = '';
      setListMessage(addList, 'Loading users…');
      updateAddSelection();
      showModal('gp-add-members-modal');

      request('GET', '/users')
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setListMessage(addList, (result.data && result.data.error) || 'Could not load users.');
            return;
          }
          var memberIds = {};
          group.members.forEach(function (user) { memberIds[user.id] = true; });
          candidates = result.data.filter(function (user) { return !user.isAdmin && !memberIds[user.id]; });
          renderCandidates();
          addSearch.focus();
        })
        .catch(function (err) {
          console.error('[user-group] users fetch failed:', err);
          setListMessage(addList, 'Could not load users.');
        });
    }

    addMembersBtn.addEventListener('click', openAddMembers);

    addSubmit.addEventListener('click', function () {
      var ids = Object.keys(chosen);
      if (!ids.length) return;

      addSubmit.disabled = true;
      addSubmit.textContent = 'Adding…';
      request('POST', '/user-groups/' + encodeURIComponent(group.id) + '/members', { userIds: ids })
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status === 200 && result.data) {
            closeModal();
            showToast('Added ' + people(result.data.added) + ' to the group.', 'success');
            loadGroup();
            return;
          }
          showToast((result.data && result.data.error) || 'Could not add those people.', 'error');
          updateAddSelection();
        })
        .catch(function (err) {
          console.error('[user-group] add members failed:', err);
          showToast('Could not add those people.', 'error');
          updateAddSelection();
        });
    });

    var editForm = document.getElementById('gp-edit-form');
    var editStatus = document.getElementById('gp-edit-status');
    var editSubmit = document.getElementById('gp-edit-submit');
    var editName = document.getElementById('gp-edit-name');
    var editDescription = document.getElementById('gp-edit-description');

    function openEdit() {
      clearFormStatus(editStatus);
      editName.value = group.name;
      editDescription.value = group.description || '';
      showModal('gp-edit-modal');
      editName.focus();
    }

    editForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFormStatus(editStatus);
      var name = editName.value.trim();
      if (!name) {
        setFormStatus(editStatus, 'Please name the group.', 'error');
        return;
      }

      editSubmit.disabled = true;
      request('PATCH', '/user-groups/' + encodeURIComponent(group.id), { name: name, description: editDescription.value.trim() })
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status === 200 && result.data) {
            closeModal();
            showToast('Group updated.', 'success');
            loadGroup();
            return;
          }
          setFormStatus(editStatus, (result.data && result.data.error) || 'Could not update the group.', 'error');
        })
        .catch(function (err) {
          console.error('[user-group] update failed:', err);
          setFormStatus(editStatus, 'Something went wrong. Please try again.', 'error');
        })
        .finally(function () { editSubmit.disabled = false; });
    });

    function deleteGroup() {
      if (!window.confirm('Delete the group "' + group.name + '"? The people in it keep their accounts, and emails already sent or scheduled are not affected.')) return;

      request('DELETE', '/user-groups/' + encodeURIComponent(group.id))
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status === 200) {
            window.location.href = GROUPS_PAGE;
            return;
          }
          showToast((result.data && result.data.error) || 'Could not delete the group.', 'error');
        })
        .catch(function (err) {
          console.error('[user-group] delete failed:', err);
          showToast('Could not delete the group.', 'error');
        });
    }

    var STATUS_BADGES = {
      sent: { className: 'status-completed', label: 'Sent' },
      pending: { className: 'status-pending', label: 'Scheduled' },
      partial: { className: 'status-pending', label: 'Sending' },
      failed: { className: 'status-expired', label: 'Failed' },
      cancelled: { className: 'status-cancelled', label: 'Cancelled' }
    };

    function emailState(email) {
      if (email.pending && email.sent) return 'partial';
      if (email.pending) return 'pending';
      if (email.sent) return 'sent';
      if (email.failed) return 'failed';
      return 'cancelled';
    }

    function cancelGroupEmail(email, btn) {
      var separate = email.kind === 'separate';
      var question = separate
        ? 'Cancel this email for the ' + people(email.pending) + ' it has not gone to yet?'
        : 'Cancel this scheduled email to the whole group?';
      if (!window.confirm(question)) return;

      btn.disabled = true;
      btn.textContent = 'Cancelling…';
      var path = separate
        ? '/email-batches/' + encodeURIComponent(email.id) + '/cancel'
        : '/user-groups/' + encodeURIComponent(group.id) + '/emails/' + encodeURIComponent(email.id) + '/cancel';

      request('POST', path)
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status === 200) {
            var message = separate
              ? 'Cancelled ' + plural(result.data.cancelled, 'scheduled email') + '.' +
                (result.data.stillSending ? ' ' + result.data.stillSending + ' were already being sent.' : '')
              : 'Scheduled email cancelled.';
            showToast(message, 'success');
            loadEmails();
            return;
          }
          showToast((result.data && result.data.error) || 'Could not cancel that email.', 'error');
          loadEmails();
        })
        .catch(function (err) {
          console.error('[user-group] cancel failed:', err);
          showToast('Could not cancel that email.', 'error');
          btn.disabled = false;
          btn.textContent = 'Cancel';
        });
    }

    function renderEmailRow(email) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';
      var title = document.createElement('div');
      title.className = 'onboarding-row-name';
      title.textContent = email.title;
      info.appendChild(title);

      var kind = email.kind === 'separate'
        ? 'Separate emails to ' + people(email.recipients)
        : 'One email to ' + people(email.recipients) +
          (email.addressing === 'bcc' ? ' (BCC)' : ' (To)');
      var parts = [kind];
      var state = emailState(email);
      if (state === 'pending') parts.push('Scheduled for ' + new Date(email.scheduledAt).toLocaleString());
      if (email.kind === 'separate' && (state === 'partial' || email.failed || email.cancelled)) {
        parts.push([
          email.sent ? email.sent + ' sent' : '',
          email.pending ? email.pending + ' waiting' : '',
          email.failed ? email.failed + ' failed' : '',
          email.cancelled ? email.cancelled + ' cancelled' : ''
        ].filter(Boolean).join(', '));
      }
      if (email.lastSentAt && state !== 'pending') parts.push('Sent ' + new Date(email.lastSentAt).toLocaleString());
      if (email.sentBy) parts.push('by ' + email.sentBy);

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = parts.join(' · ').replace(' · by ', ' by ');
      info.appendChild(meta);

      if (email.failed && email.lastError) {
        var error = document.createElement('div');
        error.className = 'onboarding-row-error';
        error.textContent = email.lastError;
        info.appendChild(error);
      }
      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';
      if (email.pending && can('email_users')) {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'onboarding-row-btn is-danger';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () { cancelGroupEmail(email, cancel); });
        actions.appendChild(cancel);
      }
      var style = STATUS_BADGES[state];
      var badge = document.createElement('span');
      badge.className = 'onboarding-badge ' + style.className;
      badge.textContent = style.label;
      actions.appendChild(badge);
      row.appendChild(actions);
      return row;
    }

    function loadEmails() {
      if (!group || !can('email_users')) return;
      setListMessage(emailsList, 'Loading emails…');
      request('GET', '/user-groups/' + encodeURIComponent(group.id) + '/emails')
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setListMessage(emailsList, (result.data && result.data.error) || 'Could not load emails.');
            return;
          }
          emailsList.innerHTML = '';
          if (!result.data.length) {
            setListMessage(emailsList, 'Nothing has been emailed to this group yet.');
            return;
          }
          result.data.forEach(function (email) { emailsList.appendChild(renderEmailRow(email)); });
        })
        .catch(function (err) {
          console.error('[user-group] emails fetch failed:', err);
          setListMessage(emailsList, 'Could not load emails.');
        });
    }

    function loadGroup() {
      return request('GET', '/user-groups/' + encodeURIComponent(groupId))
        .then(function (result) {
          if (result.status === 404 || result.status === 400) {
            showPanel('gp-missing-panel');
            return;
          }
          if (result.status !== 200 || !result.data || !result.data.id) {
            if (handleApiFailure(result)) return;
            showPanel('gp-error-panel');
            return;
          }
          var firstLoad = !group;
          group = result.data;
          renderHeader();
          renderMembers();
          if (firstLoad) {
            renderActions();
            showPanel('gp-content-panel');
          }
        })
        .catch(function (err) {
          console.error('[user-group] group fetch failed:', err);
          showPanel('gp-error-panel');
        });
    }

    function checkAuth() {
      showPanel('gp-loading-panel');
      if (!groupId) {
        showPanel('gp-missing-panel');
        return;
      }

      request('GET', '/auth')
        .then(function (result) {
          if (!result.data || !result.data.auth) {
            goToLogin();
            return;
          }
          logoutButtons.forEach(function (btn) { btn.classList.add('is-visible'); });

          var user = result.data.user || {};
          myPermissions = Array.isArray(user.permissions) ? user.permissions : [];

          if (!can('manage_users') && !can('email_users')) {
            showPanel('gp-denied-panel');
            return;
          }

          addMembersBtn.hidden = !can('manage_users');
          emailsTab.hidden = !can('email_users');
          loadGroup();
        })
        .catch(function (err) {
          console.error('[user-group] auth check failed:', err);
          showPanel('gp-error-panel');
        });
    }

    var retryBtn = document.getElementById('gp-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', checkAuth);

    checkAuth();
  });
})();
