#!/usr/bin/env node

const program = require('commander');
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

/* gets the latest version number for the lambda function */
function getLambdaFunctionLastVersion(functionName) {
    var output = JSON.parse(execSync(`aws lambda list-versions-by-function --region eu-central-1 --function-name ${functionName}`));
    var latestVersionNumber = output.Versions[output.Versions.length-1].Version;
    while(output.NextMarker) {
        output = JSON.parse(execSync(`aws lambda list-versions-by-function --region eu-central-1 --function-name ${functionName} --marker ${output.NextMarker}`));
        latestVersionNumber = output.Versions[output.Versions.length-1].Version;
	}
	return latestVersionNumber;
}

program
	.option('-p, --profile <profile>', 'The local profile to use when deploying')
	.option('-r, --region <region>', 'The region in which to deploy the function')
	.parse(process.argv);

var lambdaspec = program.args[0].trim();
var stage = program.args[1].trim();

//get the actual lambda spec
var lambdaspecFullpath = fs.realpathSync(lambdaspec);
lambdaspec = require(lambdaspecFullpath);

// the version number will be dynamically generated
var version = (program.args[2]) ? program.args[2].trim().replace("$","\$") : getLambdaFunctionLastVersion(lambdaspec.lambdaconfig.FunctionName);

//set the profile object according to the profile and region settings
var profile = program.profile ? `--profile ${program.profile}` : "";
profile += program.region ? ` --region ${program.region}` : "";

//first get the list of aliases that exist
//and determine whether we are updating an existing alias or creating a new one
var create = true;
try {

	var aliases = execSync(`aws lambda list-aliases ${profile} --function-name ${lambdaspec.lambdaconfig.FunctionArn}`);
	aliases = JSON.parse(aliases);
	aliases.Aliases.forEach((alias) => {
		//if we find an existing alias with the same name as the stage we are trying
		//to update, then we stop iterating over the aliases and will do an alias
		//update statement
		if (stage == alias.Name) {
			create = false;
		}
	});	
} catch (err) {
	console.error(`Error retrieving list of aliases from aws for '${lambdaspec.lambdaconfig.FunctionArn}': ${err.message}`);
	process.exit(1);
}

if (create) {
	try {
		var res = execSync(`aws lambda create-alias ${profile} --function-name ${lambdaspec.lambdaconfig.FunctionArn} --name ${stage} --function-version '${version}'`);
	} catch (err) {
		console.error(`Error creating new stage '${stage}' for '${lambdaspec.lambdaconfig.FunctionArn}': ${err.message}`);
		process.exit(1);
	}
} else {
	try {
		var res = execSync(`aws lambda update-alias ${profile} --function-name ${lambdaspec.lambdaconfig.FunctionArn} --name ${stage} --function-version '${version}'`);
	} catch (err) {
		console.error(`Error updating stage '${stage}' for '${lambdaspec.lambdaconfig.FunctionArn}': ${err.message}`);
		process.exit(1);
	}
}

//update the version history object with the stage info
// var lambdaspecPath = path.dirname(lambdaspecFullpath);
// var lambdaspecHistory = `${path.basename(lambdaspecFullpath, '.json')}-history.json`;

// var history = JSON.parse(fs.readFileSync(path.join(lambdaspecPath,lambdaspecHistory)));
// history.aliases = history.aliases || {};

//if we did a create then simply create a new object for the stage in question and write
//it out
//in the event that we are updating an existing alias and pointing it to a new version
//then we set the current version to the one that was requested and then if the 
//the version history doesn't contain the current version requested we push it onto the
//list
// if (create) {
// 	history.aliases[stage] = {
// 		current: version,
// 		versions: [version]
// 	}; 
// } else {
// 	history.aliases[stage] = history.aliases[stage] || {current:"", versions:[]};
// 	history.aliases[stage].current = version;
// 	if (!history.aliases[stage].versions.includes(version))
// 		history.aliases[stage].versions.push(version);
// }

// //now save the history object to file
// fs.writeFileSync(path.join(lambdaspecPath, lambdaspecHistory),
// 					JSON.stringify(history, null, 2));
console.log(`Lambda stage '${stage}' set to point to version '${version}'`);

process.exit(0);



