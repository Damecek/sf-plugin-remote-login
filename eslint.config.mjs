import tsconfigs from 'eslint-config-salesforce-typescript';

export default [
  ...tsconfigs,
  { ignores: ['lib/**', 'bin/**', 'oclif.manifest.json'] },
  {
    rules: {
      'header/header': 'off',
      'jsdoc/newline-after-description': 'off',
    },
  },
];
