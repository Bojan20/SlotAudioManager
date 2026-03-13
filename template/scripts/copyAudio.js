#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;

const settings = JSON.parse(fs.readFileSync("settings.json"));

const audio = new Map(Object.entries(settings || {}));

const gameProjectPath = audio.get('gameProjectPath');

const distSoundFolder = "./dist/soundFiles";
const distFolder = "./dist";


function copyDirectory(path) {
    fs.readdirSync(path).forEach(element => {
        const filePath = path + "/" + element;
        let destPath = null;
        if (!element.startsWith(".") && fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
            //process and copy file
            console.log("process " + element);
            destPath = gameProjectPath + "/assets/default/default/default/sounds/soundFiles/";

            if (destPath) {
                console.log("copy from " + filePath + " to " + destPath + element);
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(gameProjectPath + "/assets/default/default/default/sounds/", { recursive: true });
                    fs.mkdirSync(destPath, { recursive: true });
                }
                fs.copyFileSync(filePath, destPath + element);
            }
        }
    })
}

function copySoundConfigToGame(path) {
    console.log( " source sound json file path - " + path);
    if (!fs.existsSync(path + "/sounds.json")) {
        console.log(path + "/sounds.json is missing from dist folder, skipping");

    } else {
        let filePath = path + "/sounds.json";
        let destPath = gameProjectPath + "/assets/default/default/default/sounds/";
        if (fs.existsSync(destPath + "/sounds.json")) {
            fs.rmSync(destPath + "/sounds.json", { recursive: true });
        }else if(fs.existsSync(destPath + "/sounds.json5")) {
            fs.rmSync(destPath + "/sounds.json5", { recursive: true });
        }
        if (!fs.existsSync(destPath)) {
            console.log( " make dest folder");
            fs.mkdirSync(destPath, { recursive: true });
        }
        let destSoundJsonPath = destPath + "/sounds.json";
        console.log(" File Path = " + filePath + " Destination path = > " + destPath + "/sounds.json") 
        fs.copyFileSync(filePath, destSoundJsonPath);
    }
    if (!fs.existsSync(path + "/sounds.json5")) {
        console.log(path + "/sounds.json5 is missing from dist folder, skipping");

    } else {
        let filePath = path + "/sounds.json5";
        let destPath = gameProjectPath + "/assets/default/default/default/sounds";
        console.log("copy from " + filePath + " to " + destPath + "/sounds.json5");
        
        if (fs.existsSync(destPath + "/sounds.json")) {
            fs.rmSync(destPath + "/sounds.json", { recursive: true });
        }else if(fs.existsSync(destPath + "/sounds.json5")) {
            fs.rmSync(destPath + "/sounds.json5", { recursive: true });
        }

        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        }
        fs.copyFileSync(filePath, destPath + "/sounds.json5");
    }

}

function copySoundsToGame(path) {
    if (!fs.existsSync(path)) {
        console.log("Sounds Folder" + " missing, skipping...");
    } else {
        copyDirectory(path);
    }
}

if (audio !== "") {
    console.log("audio files:");
    console.log(gameProjectPath);

    if (!fs.existsSync(gameProjectPath + "/assets")) {
        console.log("Game Path " + gameProjectPath + "/assets" + " missing, skipping...");
    } else {
        if(fs.existsSync(gameProjectPath + "/assets/default/default/default/sounds/")) {
            fs.rmSync(gameProjectPath + "/assets/default/default/default/sounds/", { recursive: true, force: true });
        }
        copySoundConfigToGame(distFolder);
        copySoundsToGame(distSoundFolder);
    }
}