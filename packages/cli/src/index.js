import { Command } from 'commander';
const program = new Command();
program
    .name('julion')
    .description('JULION developer snapshot CLI')
    .version('0.1.0');
program
    .command('init')
    .description('Initialize JULION in the current project')
    .action(() => {
    console.log('julion init: scaffolding project metadata');
});
program
    .command('save')
    .description('Create a .on snapshot for the current project')
    .action(() => {
    console.log('julion save: snapshot engine will run here');
});
program
    .command('auth')
    .description('Authenticate with cloud providers')
    .argument('<provider>', 'provider name')
    .action((provider) => {
    console.log(`julion auth ${provider}: starting auth flow`);
});
program.parse(process.argv);
//# sourceMappingURL=index.js.map