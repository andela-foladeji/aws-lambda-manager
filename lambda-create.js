#!/usr/bin/env node

const program = require('commander');
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

program
	.option('-n, --skip-upload', 'Skip creating a local zip file and uploading to s3')
	.option('-s, --stage <stage>', 'The stage alias to assign the upload')
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

var current_time = new Date().getTime();
var zipfile = `${lambdaspec.zipfile}_${current_time}.zip`;
var s3bucket = lambdaspec.s3bucket;
var s3keyprefix = lambdaspec.s3keyprefix;
var s3key = s3keyprefix + zipfile;

//set the profile object according to the profile and region settings
var profile = program.profile ? `--profile ${program.profile}` : "";
profile += program.region ? ` --region ${program.region}` : "";

//if the skip-upload flag is set then we skip over zipping and uploading the package to s3
if (!program.skipUpload) {
	
	var files = lambdaspec.files;
	var filepaths = files;//files.map((glob) => { return path.isAbsolute(glob) ? glob : path.join(process.cwd(), glob); });
	var zipabsolute = path.isAbsolute(zipfile) ? zipfile : path.join(process.cwd(), zipfile);
	var ziplocal = path.join(path.dirname(zipfile),path.basename(zipfile,'.zip'));//path.isAbsolute(zipfile) ? zipfile : path.join(process.cwd(), zipfile);
	
	try {
		execSync(`rm -f ${lambdaspec.zipfile}_*.zip`);
	} catch (err) {
		console.error(`Error removing old zip files: ${err.message}`);
		process.exit(1);
	}
	
	//run an npm update to get the latest dependencies
	console.log(`Updating package dependencies...`);
	try {
		execSync('npm update -S && npm update -D');
	} catch (err) {
		console.error(`Error updating dependencies: ${err.message}`);
		process.exit(1);
	}
	
	//compile the package
	console.log(`Compiling package...`);
	try {
		execSync('npm run compile');
	} catch (err) {
		console.error(`Error compiling package: ${err.message}`);
		process.exit(1);
	}
	
	//remove dev dependencies from output to streamline output
	console.log(`Removing dev dependencies...`);
	try {
		execSync('npm prune --production');
	} catch (err) {
		console.error(`Error removing dev dependencies: ${err.message}`);
		process.exit(1);
	}
	
	//zip up the distribution files
	console.log(`Creating distribution package '${zipfile}' from [${files.join()}]...`);
	try {
		execSync(`zip -rq ${ziplocal} ${filepaths.join(" ")} package.json node_modules`);
	} catch (err) {
		console.error(`Error zipping file: ${err.message}`);
		process.exit(1);
	}
	
	//upload the zip file to s3
	console.log(`Uploading '${zipfile}' to '${s3bucket}' with key '${s3key}'...`);
	try {
		execSync(`aws s3api put-object ${profile} --bucket ${s3bucket} --key ${s3key} --body ${zipabsolute}`);
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
var createRes = '';
try {
	createRes = execSync(`aws lambda create-function ${profile} --code ${codeSpec} ${vpcspec} --cli-input-json '${JSON.stringify(lambdaconfig)}'`,
							null, {stdio:['pipe','pipe','ignore']});
} catch (err) {
	console.error(`Error creating lambda function: ${err.message}`);
	process.exit(1);
}
createRes = JSON.parse(createRes);
console.log(`Lambda function created with resource ARN '${createRes.FunctionArn}'`);

//update the function spec with lambda function ARN
lambdaspec.lambdaconfig.FunctionArn = createRes.FunctionArn;
fs.writeFileSync(lambdaspecFullpath, JSON.stringify(lambdaspec, null, 2));

//if the create was successful and a stage is specified then an alias is also created 
//the alias will point to the specific version of the lambda function just published
var stage = program.stage;
var aliasRes = null;
if (createRes && stage) {
	var funcVersion = createRes.Version;
	console.log(`Creating alias '${stage}' for lambda function '${lambdaconfig.FunctionName}' version '${funcVersion}'`);
	try {
		aliasRes = execSync(`aws lambda create-alias ${profile} --function-name ${createRes.FunctionArn} --name ${stage} --function-version '${funcVersion}'`,
								null, {stdio:['pipe','pipe','ignore']});
		aliasRes = JSON.parse(aliasRes);
		console.log(`Alias created`);		
	} catch (err) {
		console.error(`Error creating alias for lambda function '${lambdaconfig.FunctionName}': ${err.message}`);
		process.exit(1);
	}
}

//if the lambda function was successfully created
//create a version history object and update it with the information about the deployment
if (createRes) {
	var history = {};

	//create a versions entry that is an array of deployments
	history.versions = [];
	
	//create the deployment object
	var user = execSync(`git config github.user`);
	var deployment = {
		lambdaVersion: createRes.Version,
		moduleVersion: lambdaspec.version,
		date: createRes.LastModified,
		user: user.toString().trim()
	};
	history.versions.push(deployment);
	
	history.aliases = {};
	//if there is a stage that is set then add that to the aliases structure
	if (stage) {
		history.aliases[stage] = {
			current: aliasRes.FunctionVersion,
			versions: [createRes.Version]
		};
	}
	
	//now save the history object to file
	var lambdaspecPath = path.dirname(lambdaspecFullpath);
	var lambdaspecFile = path.basename(lambdaspecFullpath, '.json');
	fs.writeFileSync(path.join(lambdaspecPath, `${lambdaspecFile}-history.json`),
						JSON.stringify(history, null, 2));
}

process.exit(0);



