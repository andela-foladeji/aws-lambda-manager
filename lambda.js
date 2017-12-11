#!/usr/bin/env node

const program = require('commander');

program
	.version('0.0.1')
	.command('create <spec>', 'Creates a new lambda function')
	.command('update <spec>', 'Updates an existing lambda function')
	.command('set-stage <spec> <stage> <version>', 'Sets the stage for a lambda function to point to a particular version')
	.parse(process.argv);