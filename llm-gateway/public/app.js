const { createApp, ref, reactive, onMounted, computed } = Vue;

const app = createApp({
  setup() {
    const currentTab = ref('dashboard');
    const providers = ref([]);
    const settings = ref({
      telegram_bot_token: '',
      telegram_chat_id: '',
      notification_cooldown_minutes: '5',
      proxy_url: '',
      allowed_models: []
    });
    const status = ref({});
    const stats = ref({});
    const logs = ref([]);
    const toasts = ref([]);
    const clients = ref([]);

    // Provider form
    const showAddProvider = ref(false);
    const editingProvider = ref(null);
    const deletingProvider = ref(null);
    const providerForm = reactive({
      name: '',
      base_url: '',
      api_keys_text: '',
      route_type: 'direct',
      supported_models_text: '',
      model_mapping_text: '{}',
      priority: 100,
      recovery_minutes: 5,
      enabled: true
    });

    // Model whitelist
    const newModel = ref('');

    // Client form
    const showAddClient = ref(false);
    const editingClient = ref(null);
    const deletingClient = ref(null);
    const clientForm = reactive({
      name: '',
      default_model: '',
      provider_order: [],
      model_mapping_text: '{}'
    });

    // Toast notifications
    let toastId = 0;
    function showToast(message, type = 'info') {
      const id = ++toastId;
      toasts.value.push({ id, message, type });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 3000);
    }

    // API calls
    async function api(method, path, data = null) {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (data) {
        options.body = JSON.stringify(data);
      }
      const response = await fetch(path, options);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Request failed');
      }
      return response.json();
    }

    // Load data
    async function loadProviders() {
      try {
        providers.value = await api('GET', '/api/providers');
      } catch (e) {
        showToast('Failed to load providers: ' + e.message, 'error');
      }
    }

    async function loadSettings() {
      try {
        const data = await api('GET', '/api/settings');
        settings.value = {
          ...settings.value,
          ...data,
          allowed_models: data.allowed_models || []
        };
      } catch (e) {
        showToast('Failed to load settings: ' + e.message, 'error');
      }
    }

    async function loadStatus() {
      try {
        status.value = await api('GET', '/api/status');
      } catch (e) {
        console.error('Failed to load status:', e);
      }
    }

    async function loadStats() {
      try {
        stats.value = await api('GET', '/api/stats');
      } catch (e) {
        console.error('Failed to load stats:', e);
      }
    }

    async function loadLogs() {
      try {
        logs.value = await api('GET', '/api/logs?limit=100');
      } catch (e) {
        showToast('Failed to load logs: ' + e.message, 'error');
      }
    }

    async function loadClients() {
      try {
        clients.value = await api('GET', '/api/clients');
      } catch (e) {
        showToast('Failed to load clients: ' + e.message, 'error');
      }
    }

    // Provider actions
    function editProvider(provider) {
      editingProvider.value = provider;
      providerForm.name = provider.name;
      providerForm.base_url = provider.base_url;
      providerForm.api_keys_text = (provider.api_keys || []).join('\n');
      providerForm.route_type = provider.route_type || 'direct';
      providerForm.supported_models_text = (provider.supported_models || []).join('\n');
      providerForm.model_mapping_text = JSON.stringify(provider.model_mapping || {}, null, 2);
      providerForm.priority = provider.priority || 100;
      providerForm.recovery_minutes = provider.recovery_minutes || 5;
      providerForm.enabled = provider.enabled === 1 || provider.enabled === true;
    }

    function closeProviderModal() {
      showAddProvider.value = false;
      editingProvider.value = null;
      resetProviderForm();
    }

    function resetProviderForm() {
      providerForm.name = '';
      providerForm.base_url = '';
      providerForm.api_keys_text = '';
      providerForm.route_type = 'direct';
      providerForm.supported_models_text = '';
      providerForm.model_mapping_text = '{}';
      providerForm.priority = 100;
      providerForm.recovery_minutes = 5;
      providerForm.enabled = true;
    }

    async function saveProvider() {
      try {
        const data = {
          name: providerForm.name,
          base_url: providerForm.base_url,
          api_keys: providerForm.api_keys_text.split('\n').map(k => k.trim()).filter(k => k),
          route_type: providerForm.route_type,
          supported_models: providerForm.supported_models_text.split('\n').map(m => m.trim()).filter(m => m),
          model_mapping: JSON.parse(providerForm.model_mapping_text || '{}'),
          priority: providerForm.priority,
          recovery_minutes: providerForm.recovery_minutes,
          enabled: providerForm.enabled
        };

        if (editingProvider.value) {
          await api('PUT', `/api/providers/${editingProvider.value.id}`, data);
          showToast('Provider updated', 'success');
        } else {
          await api('POST', '/api/providers', data);
          showToast('Provider added', 'success');
        }

        closeProviderModal();
        await loadProviders();
        await loadStatus();
      } catch (e) {
        showToast('Failed to save provider: ' + e.message, 'error');
      }
    }

    async function toggleProvider(provider) {
      try {
        await api('POST', `/api/providers/${provider.id}/toggle`);
        await loadProviders();
        await loadStatus();
      } catch (e) {
        showToast('Failed to toggle provider: ' + e.message, 'error');
      }
    }

    async function resetProvider(provider) {
      try {
        await api('POST', `/api/providers/${provider.id}/reset`);
        showToast('Provider health reset', 'success');
        await loadProviders();
        await loadStatus();
      } catch (e) {
        showToast('Failed to reset provider: ' + e.message, 'error');
      }
    }

    function confirmDelete(provider) {
      deletingProvider.value = provider;
    }

    async function deleteProviderConfirmed() {
      try {
        await api('DELETE', `/api/providers/${deletingProvider.value.id}`);
        showToast('Provider deleted', 'success');
        deletingProvider.value = null;
        await loadProviders();
        await loadStatus();
      } catch (e) {
        showToast('Failed to delete provider: ' + e.message, 'error');
      }
    }

    // Settings actions

    // Client actions
    function editClient(client) {
      editingClient.value = client;
      clientForm.name = client.name;
      clientForm.default_model = client.default_model || '';
      clientForm.provider_order = [...(client.provider_order || [])];
      clientForm.model_mapping_text = JSON.stringify(client.model_mapping || {}, null, 2);
    }

    function closeClientModal() {
      showAddClient.value = false;
      editingClient.value = null;
      clientForm.name = '';
      clientForm.default_model = '';
      clientForm.provider_order = [];
      clientForm.model_mapping_text = '{}';
    }

    async function saveClient() {
      try {
        const data = {
          name: clientForm.name,
          default_model: clientForm.default_model || null,
          provider_order: clientForm.provider_order.filter(p => p),
          model_mapping: JSON.parse(clientForm.model_mapping_text || '{}')
        };

        if (editingClient.value) {
          await api('PUT', `/api/clients/${editingClient.value.id}`, data);
          showToast('Client updated', 'success');
        } else {
          await api('POST', '/api/clients', data);
          showToast('Client added', 'success');
        }

        closeClientModal();
        await loadClients();
      } catch (e) {
        showToast('Failed to save client: ' + e.message, 'error');
      }
    }

    async function toggleClient(client) {
      try {
        await api('POST', `/api/clients/${client.id}/toggle`);
        await loadClients();
      } catch (e) {
        showToast('Failed to toggle client: ' + e.message, 'error');
      }
    }

    async function regenerateKey(client) {
      if (!confirm(`Regenerate API key for "${client.name}"? The old key will stop working immediately.`)) return;
      try {
        const updated = await api('POST', `/api/clients/${client.id}/regenerate-key`);
        showToast('API key regenerated. New key: ' + updated.api_key, 'success');
        await loadClients();
      } catch (e) {
        showToast('Failed to regenerate key: ' + e.message, 'error');
      }
    }

    function confirmDeleteClient(client) {
      deletingClient.value = client;
    }

    async function deleteClientConfirmed() {
      try {
        await api('DELETE', `/api/clients/${deletingClient.value.id}`);
        showToast('Client deleted', 'success');
        deletingClient.value = null;
        await loadClients();
      } catch (e) {
        showToast('Failed to delete client: ' + e.message, 'error');
      }
    }

    function getProviderName(id) {
      const p = providers.value.find(pr => pr.id === id);
      return p ? p.name : `#${id}`;
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard', 'success');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    }

    // Settings actions (original)
    async function saveSettings() {
      try {
        await api('PUT', '/api/settings', settings.value);
        showToast('Settings saved', 'success');
      } catch (e) {
        showToast('Failed to save settings: ' + e.message, 'error');
      }
    }

    function addModel() {
      if (newModel.value.trim()) {
        if (!settings.value.allowed_models) {
          settings.value.allowed_models = [];
        }
        settings.value.allowed_models.push(newModel.value.trim());
        newModel.value = '';
      }
    }

    function removeModel(index) {
      settings.value.allowed_models.splice(index, 1);
    }

    // Formatting helpers
    function formatTimestamp(ts) {
      if (!ts) return '-';
      return new Date(ts * 1000).toLocaleString();
    }

    function formatTime(isoString) {
      if (!isoString) return '-';
      return new Date(isoString).toLocaleTimeString();
    }

    function routeTypeColor(type) {
      switch (type) {
        case 'local': return 'bg-green-900 text-green-300';
        case 'domestic': return 'bg-blue-900 text-blue-300';
        case 'overseas': return 'bg-purple-900 text-purple-300';
        default: return 'bg-gray-700 text-gray-300';
      }
    }

    // Initialize
    onMounted(async () => {
      await Promise.all([
        loadProviders(),
        loadSettings(),
        loadStatus(),
        loadStats(),
        loadLogs(),
        loadClients()
      ]);

      // Auto-refresh status every 30 seconds
      setInterval(() => {
        loadStatus();
        loadStats();
      }, 30000);
    });

    return {
      currentTab,
      providers,
      settings,
      status,
      stats,
      logs,
      toasts,
      clients,
      showAddProvider,
      editingProvider,
      deletingProvider,
      providerForm,
      showAddClient,
      editingClient,
      deletingClient,
      clientForm,
      newModel,
      loadProviders,
      loadLogs,
      loadClients,
      editProvider,
      closeProviderModal,
      saveProvider,
      toggleProvider,
      resetProvider,
      confirmDelete,
      deleteProviderConfirmed,
      editClient,
      closeClientModal,
      saveClient,
      toggleClient,
      regenerateKey,
      confirmDeleteClient,
      deleteClientConfirmed,
      getProviderName,
      copyToClipboard,
      saveSettings,
      addModel,
      removeModel,
      formatTimestamp,
      formatTime,
      routeTypeColor
    };
  }
});

app.mount('#app');
