#!/usr/bin/env node

const program = require('commander');
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

program
	.option('-n, --no-upload', 'if set, creation and uploading of a new zip package is skipped')
	.option('-s, --stage <stage>', 'the stage to deploy to')
	.option('-p, --profile <profile>', 'the profile to use for deployment')
	.option('-r, --region <region>', 'the region in which to deploy the function')
	.parse(process.argv);

var stage = program.stage;
var lambdaspec = program.args;
var region = program.region;

if (!lambdaspec.length) {
	console.error('No lambda spec given');
	process.exit(1);
}

var lambdaspecFullpath = fs.realpathSync(lambdaspec[0]);
lambdaspec = require(lambdaspecFullpath);

var zipfile = lambdaspec.zipfile;
var files = lambdaspec.files;
var s3bucket = lambdaspec.s3bucket;
var s3keyprefix = lambdaspec.s3keyprefix;

//set the real paths
var zippath = path.isAbsolute(zipfile) ? zipfile : path.join(process.cwd(), zipfile);
var filepaths = files.map((glob) => { return path.isAbsolute(glob) ? glob : path.join(process.cwd(), glob); });
var s3key = s3keyprefix + zipfile;
var profile = program.profile ? `--profile ${program.profile}` : "";
profile += program.region ? ` --region ${program.region}` : "";

//if the no-upload flag is set then we skip over zipping up the contents of the 
//package and go straight to setting up the lambda function
if (!program.upload) {
	//zip up the distribution files
	console.log(`Creating lambda function distribution package '${zipfile}' from [${files.join()}]...`);
	try {
		execSync(`zip -rq ${zippath} ${filepaths.join(" ")} ${fs.realpathSync('package.json')} ${fs.realpathSync('node_modules')}`);
	} catch (err) {
		console.error(`Error zipping file: ${err.message}`);
		process.exit(1);
	}
	
	
	//upload the zip file to s3
	console.log(`Uploading '${zipfile}' to '${s3bucket}' with key '${s3key}'...`);
	try {
		execSync(`aws s3api put-object --bucket ${s3bucket} --key ${s3key} --body ${zippath} ${profile}`);
	} catch (err) {
		console.error(`Error uploading '${zipfile}' to '${s3bucket}': ${err.message}`);
		process.exit(1);
	}
}

//create the lambda function
var lambdaconfig = lambdaspec.lambdaconfig;
var codeSpec = `S3Bucket=${s3bucket},S3Key=${s3key}`;
var vpcspec = lambdaspec.vpcconfig ? `--vpc-config SubnetIds=${lambdaspec.vpcconfig.SubnetIds.join()},SecurityGroupIds=${lambdaspec.vpcconfig.SecurityGroupIds.join()}` : "";
console.log(`Creating lambda function '${lambdaconfig.FunctionName}'...`);
var res = '';
try {
	res = execSync(`aws lambda create-function ${profile} --code ${codeSpec} ${vpcspec} --cli-input-json '${JSON.stringify(lambdaconfig)}'`,
						null, {stdio:['pipe','pipe','ignore']});
} catch (err) {
	console.error(`Error creating lambda function: ${err.message}`);
	process.exit(1);
}
res = JSON.parse(res);
console.log(`Lambda function created with resource ARN '${res.FunctionArn}'`);

//if a stage is specified then an alias is also created by default this points to the '$LATEST' version
var aliasRes = null;
if (stage) {
	console.log(`Creating alias '${stage}' for lambda function '${lambdaconfig.FunctionName}'`);
	try {
		aliasRes = execSync(`aws lambda create-alias ${profile} --function-name ${res.FunctionArn} --name ${stage} --function-version '\$LATEST'`,
								null, {stdio:['pipe','pipe','ignore']});
		aliasRes = JSON.parse(aliasRes);
		console.log(`Alias created`);		
	} catch (err) {
		console.error(`Error creating alias for lambda function '${lambdaconfig.FunctionName}': ${err.message}`);
		process.exit(1);
	}
}

//if the lambda spec has a 'version' field then
//create a version history object and update it with the information about the deployment
if (lambdaspec.version && res) {
	var history = {};

	//first create a 'versions' entry that will as keys whatever version is in the 
	//lambda spec
	//the value associated with each key is an array of objects, with each object
	//containing details about the actual deployment
	history.versions = {};
	history.versions[lambdaspec.version] = [];
	
	//create the deployment object
	var user = execSync(`git config github.user`);
	var deployment = {
		version: parseInt(res.Version),
		date: res.LastModified,
		user: user.toString().trim()
	}
	history.versions[lambdaspec.version].push(deployment);
	
	//if there is a stage that is set then add that to the aliases structure
	if (stage) {
		history.aliases = {};
		history.aliases[stage] = aliasRes.FunctionVersion;
	}
	
	//now save the history object to file
	var lambdaspecPath = path.dirname(lambdaspecFullpath);
	var lambdaspecFile = path.basename(lambdaspecFullpath, '.json');
	fs.writeFileSync(path.join(lambdaspecPath, `${lambdaspecFile}-history.json`),
						JSON.stringify(history, null, 2));
}

process.exit(0);



