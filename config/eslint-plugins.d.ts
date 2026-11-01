declare module 'eslint-plugin-no-unsanitized' {
  const plugin: {
    configs: {
      recommended: {
        name?: string;
        rules?: Record<string, 'error' | 'off' | 'warn'>;
      };
    };
  };

  export default plugin;
}

declare module 'eslint-plugin-promise' {
  const plugin: {
    configs: {
      'flat/recommended': {
        name?: string;
        rules?: Record<string, 'error' | 'off' | 'warn'>;
      };
    };
  };

  export default plugin;
}
