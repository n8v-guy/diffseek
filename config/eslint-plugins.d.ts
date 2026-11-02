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
