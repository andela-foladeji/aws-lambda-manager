#!/usr/bin/env node

const program = require('commander');

program
	.version('0.0.1')
	.command('create [spec]', 'Creates a new lambda function')
	.command('update [spec]', 'Updates an existing lambda function')
	.parse(process.argv);