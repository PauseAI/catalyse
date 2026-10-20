import { execSync } from 'child_process'

function run(cmd: string) {
  execSync(cmd, { stdio: 'inherit' })
}

run('npm run generate')
run('npm run build')
run('npm run build-storybook')
