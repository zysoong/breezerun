/**
 * Feature flags for the OpenCodex application
 * These can be controlled via environment variables or localStorage for testing
 */

export const featureFlags = {
  // Enable assistant-ui integration for chat interface
  useAssistantUI: () => {
    // Check environment variable first (allows explicit disable)
    if (import.meta.env.VITE_ENABLE_ASSISTANT_UI === 'false') {
      return false;
    }

    // Check localStorage for runtime toggling (useful for A/B testing)
    if (typeof window !== 'undefined') {
      const localFlag = localStorage.getItem('enableAssistantUI');
      if (localFlag === 'false') {
        return false;
      }
      if (localFlag === 'true') {
        return true;
      }
    }

    // Default to TRUE - assistant-ui is now enabled by default
    return true;
  },

  // Helper to toggle the feature flag at runtime
  toggleAssistantUI: (enabled: boolean) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableAssistantUI', enabled ? 'true' : 'false');
      // Reload to apply changes
      window.location.reload();
    }
  },

  // Get current status for debugging
  getStatus: () => {
    return {
      assistantUI: featureFlags.useAssistantUI(),
      source: import.meta.env.VITE_ENABLE_ASSISTANT_UI === 'true'
        ? 'environment'
        : localStorage.getItem('enableAssistantUI') === 'true'
        ? 'localStorage'
        : 'default',
    };
  },
};

// Export for use in browser console for testing
if (typeof window !== 'undefined') {
  (window as any).featureFlags = featureFlags;
}