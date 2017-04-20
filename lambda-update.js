#!/usr/bin/env node

const program = require('commander');
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

program
	.option('-n, --skip-upload', 'Skip creating a local zip file and uploading to s3')
	.option('-p, --profile <profile>', 'The local profile to use when deploying')
	.option('-r, --region <region>', 'The region in which to deploy the function')
	.parse(process.argv);

//get the lambda spec path
var lambdaspec = program.args;
if (!lambdaspec.length) {
	console.error('No lambda spec given');
	process.exit(1);
}
var lambdaspecFullpath = fs.realpathSync(lambdaspec[0]);
lambdaspec = require(lambdaspecFullpath);

var zipfile = lambdaspec.zipfile;
var s3bucket = lambdaspec.s3bucket;
var s3keyprefix = lambdaspec.s3keyprefix;
var s3key = s3keyprefix + zipfile;

//set the profile object according to the profile and region settings
var profile = program.profile ? `--profile ${program.profile}` : "";
profile += program.region ? ` --region ${program.region}` : "";

//if the skip-upload flag is set then we skip over zipping and uploading the package to s3
if (!program.skipUpload) {
	
	var files = lambdaspec.files;
	var filepaths = files.map((glob) => { return path.isAbsolute(glob) ? glob : path.join(process.cwd(), glob); });
	var ziplocal = path.isAbsolute(zipfile) ? zipfile : path.join(process.cwd(), zipfile);

	//zip up the distribution files
	console.log(`Creating lambda function distribution package '${zipfile}' from [${files.join()}]...`);
	try {
		execSync(`zip -rq ${ziplocal} ${filepaths.join(" ")} ${fs.realpathSync('package.json')} ${fs.realpathSync('node_modules')}`);
	} catch (err) {
		console.error(`Error zipping file: ${err.message}`);
		process.exit(1);
	}
	
	//upload the zip file to s3
	console.log(`Uploading '${zipfile}' to '${s3bucket}' with key '${s3key}'...`);
	try {
		execSync(`aws s3api put-object ${profile} --bucket ${s3bucket} --key ${s3key} --body ${ziplocal}`);
	} catch (err) {
		console.error(`Error uploading '${zipfile}' to '${s3bucket}': ${err.message}`);
		process.exit(1);
	}
}

//update the lambda function
var lambdaconfig = lambdaspec.lambdaconfig;

console.log(`Updating lambda function '${lambdaconfig.FunctionName}'...`);
var updateRes = '';
try {
	var publish = lambdaconfig.Publish ? '--publish' : '';
	updateRes = execSync(`aws lambda update-function-code ${profile} --function-name ${lambdaconfig.FunctionArn} --s3-key ${s3key} --s3-bucket ${s3bucket} ${publish}`,
							null, {stdio:['pipe','pipe','ignore']});
} catch (err) {
	console.error(`Error updating lambda function: ${err.message}`);
	process.exit(1);
}
updateRes = JSON.parse(updateRes);
console.log(`Lambda function updated`);

//if the lambda function was successfully updated
//update the version history object
if (updateRes) {
	
	var lambdaspecPath = path.dirname(lambdaspecFullpath);
	var lambdaspecHistory = `${path.basename(lambdaspecFullpath, '.json')}-history.json`;
	
	var history = JSON.parse(fs.readFileSync(path.join(lambdaspecPath,lambdaspecHistory)));
	
	//create a new deployment object
	var user = execSync(`git config github.user`);
	var deployment = {
		lambdaVersion: updateRes.Version,
		moduleVersion: lambdaspec.version,
		date: updateRes.LastModified,
		user: user.toString().trim()
	};
	history.versions.push(deployment);
	
	//now save the history object to file
	fs.writeFileSync(path.join(lambdaspecPath, lambdaspecHistory),
						JSON.stringify(history, null, 2));
}

process.exit(0);



