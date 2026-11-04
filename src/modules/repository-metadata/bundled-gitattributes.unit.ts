import { describe, expect, it } from 'vitest';

import { rulesFromMetadata } from './bundled-gitattributes';
import { attributesForPath } from './gitattributes';

type Row = readonly [
  path: string,
  language: string | null,
  group: string | null,
  generated?: boolean,
];

const rules = rulesFromMetadata({ attributes: '' });

const rows: readonly Row[] = [
  ['src/components/Button.tsx', 'TypeScript', null],
  ['src/util.ts', 'TypeScript', null],
  ['types/window.d.ts', 'TypeScript', null],
  ['src/util.mts', null, null],
  ['src/components/Button.test.tsx', 'TypeScript', 'Tests'],
  ['src/components/Button.spec.ts', 'TypeScript', 'Tests'],
  ['src/__tests__/Button.tsx', 'TypeScript', 'Tests'],
  ['e2e/checkout.e2e.ts', 'TypeScript', 'Tests'],
  ['src/github/review-app.e2e.playwright.ts', 'TypeScript', 'Tests'],
  ['src/components/__snapshots__/Button.test.tsx.snap', null, null, true],
  ['src/button-comp.tsx', 'TypeScript', null],
  ['src/SpeedTest/bench.ts', 'TypeScript', null],
  ['src/latest.ts', 'TypeScript', null],
  ['src/contest/Button.tsx', 'TypeScript', null],
  ['src/specification.ts', 'TypeScript', null],
  ['src/testimonials.tsx', 'TypeScript', null],
  ['src/index.js', 'JavaScript', null],
  ['src/App.jsx', 'JavaScript', null],
  ['src/util.mjs', 'JavaScript', null],
  ['src/legacy.cjs', 'JavaScript', null],
  ['src/app.min.js', 'JavaScript', null, true],
  ['src/app.min.mjs', 'JavaScript', null],
  ['package.json', null, 'Config'],
  ['package-lock.json', null, null, true],
  ['yarn.lock', null, null, true],
  ['pnpm-lock.yaml', null, null, true],
  ['tests/test_main.py', null, 'Tests'],
  ['app/models_test.py', null, 'Tests'],
  ['src/contest/test_utils.py', null, 'Tests'],
  ['pyproject.toml', null, 'Config'],
  ['requirements.txt', null, 'Config'],
  ['requirements-dev.txt', null, 'Config'],
  ['poetry.lock', null, null, true],
  ['src/test/java/com/example/AppTest.java', null, 'Tests'],
  ['src/Test/Foo.java', null, null],
  ['pom.xml', null, 'Config'],
  ['build.gradle', null, 'Config'],
  ['src/main/kotlin/com/example/App.kt', 'Kotlin', null],
  ['build.gradle.kts', 'Kotlin', 'Config'],
  ['app/src/androidTest/java/com/example/MainActivityTest.kt', 'Kotlin', 'Tests'],
  ['src/App.Tests/ProgramTests.cs', null, 'Tests'],
  ['src/App/App.csproj', null, 'Config'],
  ['App.sln', null, 'Config'],
  ['obj/Debug/App.cs', null, null],
  ['src/main.c', 'C/C++', null],
  ['src/main.cc', 'C/C++', null],
  ['src/main.cpp', 'C/C++', null],
  ['include/app.h', 'C/C++', null],
  ['include/app.hpp', 'C/C++', null],
  ['src/util.cxx', null, null],
  ['CMakeLists.txt', null, 'Config'],
  ['Makefile', null, 'Config'],
  ['third_party/sqlite/sqlite.c', 'C/C++', null, true],
  ['pkg/app/app_test.go', null, 'Tests'],
  ['go.mod', null, 'Config'],
  ['go.sum', null, null, true],
  ['tests/Controller/HomeControllerTest.php', null, 'Tests'],
  ['composer.json', null, 'Config'],
  ['composer.lock', null, null, true],
  ['vendor/lib.php', null, null, true],
  ['spec/models/user_spec.rb', null, 'Tests'],
  ['Gemfile', null, 'Config'],
  ['Gemfile.lock', null, null, true],
  ['tests/api.rs', null, 'Tests'],
  ['Cargo.toml', null, 'Config'],
  ['Cargo.lock', null, null, true],
  ['target/debug/app', null, null, true],
  ['Tests/AppTests/AppTests.swift', null, 'Tests'],
  ['test/build_test.sh', null, 'Tests'],
  ['bin/tool.sh', null, null],
  ['build/scripts/ci.sh', null, null],
  ['src/button.css', 'CSS', null],
  ['src/button.scss', 'CSS', null],
  ['src/button.less', null, null],
  ['src/button.module.css', 'CSS', null],
  ['src/button.css.ts', 'TypeScript', null],
  ['src/app.min.css', 'CSS', null, true],
  ['public/index.html', null, null],
  ['src/App.vue', null, null],
  ['src/Template.svelte', null, null],
  ['views/users/show.erb', null, null],
  ['templates/note.txt', null, null],
  ['test/widget_test.dart', null, 'Tests'],
  ['lib/data.g.dart', null, null, true],
  ['lib/data.freezed.dart', null, null, true],
  ['lib/data.pb.dart', null, null],
  ['pubspec.yaml', null, 'Config'],
  ['pubspec.lock', null, null, true],
  ['docs/guide.md', null, 'Docs'],
  ['docs/guide.mdx', null, 'Docs'],
  ['README.md', null, 'Docs'],
  ['docs/example.ts', 'TypeScript', 'Docs'],
  ['tsconfig.json', null, 'Config'],
  ['tsconfig.app.json', null, 'Config'],
  ['common/rides/.eslintrc.js', 'JavaScript', 'Config'],
  ['config/eslint.config.js', 'JavaScript', 'Config'],
  ['tailwind.config.ts', 'TypeScript', 'Config'],
  ['config/app.json', null, 'Config'],
  ['.github/workflows/ci.yml', null, 'Config'],
  ['web/dist/main.js', 'JavaScript', null, true],
  ['node_modules/left-pad/index.js', 'JavaScript', null, true],
  ['coverage/lcov.info', null, null, true],
  ['src/generated/api.ts', 'TypeScript', null, true],
  ['src/__generated__/graphql.ts', 'TypeScript', null, true],
  ['src/vendor.ts', 'TypeScript', null],
  ['.next/server/pages/index.js', 'JavaScript', null, true],
  ['gen/api.ts', 'TypeScript', null],
  ['out/app.js', 'JavaScript', null],
];

const examples = rows.map(([path, language, group, generated]) => ({
  path,
  language,
  group,
  generated: generated ?? false,
}));

describe('built-in format and group rules', () => {
  it.each(examples)('$path', ({ path, language, group, generated }) => {
    expect(attributesForPath(path, rules)).toEqual({
      language,
      group,
      generated,
    });
  });

  it('ignores built-ins when the repository defines a group or language', () => {
    const custom = rulesFromMetadata({
      attributes: '*.ts linguist-language=Flow\nsrc/** group=Code',
      nestedAttributes: { src: '*.ts !linguist-language' },
    });

    expect(attributesForPath('lib/app.ts', custom)).toEqual({
      language: 'Flow',
      group: null,
      generated: false,
    });
    expect(attributesForPath('src/app.test.ts', custom)).toEqual({
      language: null,
      group: 'Code',
      generated: false,
    });
    expect(attributesForPath('pkg/app_test.go', custom)).toEqual({
      language: null,
      group: null,
      generated: false,
    });
    expect(attributesForPath('web/dist/main.js', custom).generated).toBe(false);
  });

  it('drops built-ins when only a nested file defines a group', () => {
    const custom = rulesFromMetadata({
      attributes: '',
      nestedAttributes: { src: '*.ts group=Code' },
    });

    expect(attributesForPath('src/app.test.ts', custom)).toEqual({
      language: null,
      group: 'Code',
      generated: false,
    });
    expect(attributesForPath('lib/app_test.go', custom).group).toBeNull();
  });

  it('keeps built-ins when the repository only marks generated files', () => {
    const custom = rulesFromMetadata({
      attributes: 'output/** linguist-generated\nvendor/** linguist-generated=false',
    });

    expect(attributesForPath('src/app.test.ts', custom)).toEqual({
      language: 'TypeScript',
      group: 'Tests',
      generated: false,
    });
    expect(attributesForPath('output/app.js', custom)).toEqual({
      language: 'JavaScript',
      group: null,
      generated: true,
    });
    expect(attributesForPath('vendor/lib.php', custom).generated).toBe(false);
    expect(attributesForPath('web/dist/main.js', custom).generated).toBe(true);
  });

  it('lets a deeper nested attribute replace a shallower one', () => {
    const custom = rulesFromMetadata({
      attributes: '',
      nestedAttributes: {
        'src/app': '*.ts group=Deep',
        src: '*.ts group=Shallow',
      },
    });

    expect(attributesForPath('src/app/main.ts', custom).group).toBe('Deep');
    expect(attributesForPath('src/lib.ts', custom).group).toBe('Shallow');
    expect(attributesForPath('src/lib.ts', custom).language).toBeNull();
  });
});
