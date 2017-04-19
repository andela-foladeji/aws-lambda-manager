#!/usr/bin/env node

const program = require('commander');

program
	.version('0.0.1')
	.command('create [spec]', 'creates a new lambda function')
	.parse(process.argv);