import {
	commands,
	ExtensionContext,
	FileType,
	Uri,
	workspace,
	window
} from 'vscode';
import axios from "axios";
import * as path from "path";

export function activate(context: ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const fs = workspace.fs;
	const uri = Uri;

	const createTemplateDir = commands.registerCommand('AnkiCardTemplateEditor.createTemplateDir', async () => {
		const url = 'http://localhost:8765';
		let selectedNotetype;
		try {
			const postData = {
				"action": "modelNames",
				"version": 6,
			};

			// get list Anki notetypes
			const response = await axios.post(url, postData);
			const data = response.data;
			const notetypeNames = data.result;
			selectedNotetype = await window.showQuickPick(notetypeNames, { placeHolder: 'Select Anki Notetype:' });
			if (!selectedNotetype) {
				return;
			}
		} catch (error) {
			console.error(error);
			window.showErrorMessage('Error getting notetype list.');
		}

		try {
			const modelTemplatePostData = {
				"action": "modelTemplates",
				"version": 6,
				"params": {
					"modelName": selectedNotetype
				}
			};

			const modelStylingPostData = {
				"action": "modelStyling",
				"version": 6,
				"params": {
					"modelName": selectedNotetype
				}
			};

			const workspaceFolders = workspace.workspaceFolders;
			if (!workspaceFolders || !workspaceFolders.length) {
				window.showErrorMessage('No workspace folders found');
				return;
			}
			const projectRootPath = workspaceFolders[0].uri;

			// select notetype from
			const folderName = await window.showInputBox({ prompt: 'Enter card template folder name:' });
			if (!folderName) {
				return;
			}
			await fs.createDirectory(uri.joinPath(projectRootPath, folderName));

			// get card template for selected notetype
			const modelTemplatesResponse = await axios.post(url, modelTemplatePostData);
			const modelTemplatesData = modelTemplatesResponse.data;

			// get card styling for selected notetype
			const modelStylingResponse = await axios.post(url, modelStylingPostData);
			const modelStylingData = modelStylingResponse.data;

			// create styling.css
			const cssFilePath = uri.joinPath(projectRootPath, folderName, "styling.css");
			await fs.writeFile(cssFilePath, Buffer.from(modelStylingData.result.css));

			let newConfig: any = {};
			for (const card in modelTemplatesData.result) {
				const cardPath = uri.joinPath(projectRootPath, folderName, card);
				await fs.createDirectory(cardPath);

				const frontHtml = modelTemplatesData.result[card].Front;
				const backHtml = modelTemplatesData.result[card].Back;
				const frontFilePath = uri.joinPath(projectRootPath, folderName, card, "front.html");
				const backFilePath = uri.joinPath(projectRootPath, folderName, card, "back.html");

				await fs.writeFile(frontFilePath, Buffer.from(frontHtml));
				await fs.writeFile(backFilePath, Buffer.from(backHtml));

				newConfig = {
					...newConfig,
					[card]: {
						"front": frontFilePath.fsPath,
						"back": backFilePath.fsPath,
					}
				};
			}

			// create config file storing notetype's related information
			const configFolderPath = uri.joinPath(projectRootPath, '.config');
			fs.createDirectory(configFolderPath);

			const configFilePath = uri.joinPath(configFolderPath, 'config.json');
			const config = {
				"url": url,
				"notetype": selectedNotetype,
				"ankiConnect": {
					"version": 6,
				},
				"cardTemplate": newConfig,
				"cardCss": cssFilePath.fsPath
			};

			const configData = JSON.stringify(config, null, 2);
			await fs.writeFile(configFilePath, Buffer.from(configData));
			await backupDirectory(folderName);

			window.showInformationMessage('Card templates HTML files created successfully!');
		} catch (error) {
			console.error(error);
			window.showErrorMessage('Error creating HTML files.');
		}
	});

	const updateCurrentFile = commands.registerCommand("AnkiCardTemplateEditor.updateCurrentFile", async () => {
		try {
			let editor = window.activeTextEditor;
			if (!editor) {
				return;
			}

			const workspaceFolders = workspace.workspaceFolders;
			if (!workspaceFolders || !workspaceFolders.length) {
				window.showErrorMessage('No workspace folders found');
				return;
			}

			const projectRootPath = workspaceFolders[0].uri;
			const configFolderPath = uri.joinPath(projectRootPath, '.config');
			const configFilePath = uri.joinPath(configFolderPath, 'config.json');
			if (!await fs.stat(configFilePath).then(() => true, () => false)) {
				window.showWarningMessage('No config file found!');
				return;
			}

			const docUri = editor.document.uri;
			const fileName = path.basename(docUri.path);
			const card = path.basename(path.dirname(docUri.path));
			const fileContent = await fs.readFile(editor.document.uri);

			const configData = await fs.readFile(configFilePath);
			const config = JSON.parse(configData.toString());
			const url = config["url"];
			const notetype = config["notetype"];
			const ankiConnectVersion = config["ankiConnect"]["version"];
			let side = "";

			if (fileName === "front.html" || fileName === "back.html") {
				if (!card.startsWith("Card")) {
					return;
				}

				side = fileName === "front.html" ? "Front" : "Back";
				const cardTemplatePostData = {
					"action": "updateModelTemplates",
					"version": ankiConnectVersion,
					"params": {
						"model": {
							"name": notetype,
							"templates": {
								[card]: {
									[side]: fileContent.toString()
								}
							}
						}
					}
				};

				const cardTemplateResponse = await axios.post(url, cardTemplatePostData);
				if (cardTemplateResponse.data.error) {
					window.showErrorMessage('Error updating card template.');
					return;
				}
			}

			if (fileName === "styling.css") {
				side = "Styling";
				const cardStylingPostData = {
					"action": "updateModelStyling",
					"version": ankiConnectVersion,
					"params": {
						"model": {
							"name": notetype,
							"css": fileContent.toString()
						}
					}
				};

				const cardStylingResponse = await axios.post(url, cardStylingPostData);
				if (cardStylingResponse.data.error) {
					window.showErrorMessage('Error updating card styling.');
					return;
				}
			}

			window.showInformationMessage(`${side} of ${card} updated successfully!`);
		} catch (error) {
			console.error(error);
			window.showErrorMessage('Error updating card templates.');
		}
	});

	const syncNotetype = commands.registerCommand('AnkiCardTemplateEditor.syncNotetype', async () => {
		try {
			const workspaceFolders = workspace.workspaceFolders;
			if (!workspaceFolders || !workspaceFolders.length) {
				window.showErrorMessage('No workspace folders found');
				return;
			}
			const projectRootPath = workspaceFolders[0].uri;
			const configFolderPath = uri.joinPath(projectRootPath, '.config');
			const configFilePath = uri.joinPath(configFolderPath, 'config.json');
			if (!await fs.stat(configFilePath).then(() => true, () => false)) {
				window.showWarningMessage('No config file found!');
				return;
			}

			const configData = await fs.readFile(configFilePath);
			const config = JSON.parse(configData.toString());
			const url = config["url"];
			const notetype = config["notetype"];
			const ankiConnectVersion = config["ankiConnect"]["version"];
			let cardContent: any = {};

			for (const card in config["cardTemplate"]) {
				const frontHtmlPath = config.cardTemplate[card].front;
				const backHtmlPath = config.cardTemplate[card].back;

				const frontHtmlContent = await fs.readFile(Uri.file(frontHtmlPath));
				const backHtmlContent = await fs.readFile(Uri.file(backHtmlPath));

				cardContent = {
					...cardContent,
					[card]: {
						"Front": frontHtmlContent.toString(),
						"Back": backHtmlContent.toString(),
					}
				};
			}

			const cardTemplatePostData = {
				"action": "updateModelTemplates",
				"version": ankiConnectVersion,
				"params": {
					"model": {
						"name": notetype,
						"templates": cardContent
					}
				}
			};

			const cssFilePath = config["cardCss"];
			const cssContent = await fs.readFile(Uri.file(cssFilePath));
			const cardStylingPostData = {
				"action": "updateModelStyling",
				"version": ankiConnectVersion,
				"params": {
					"model": {
						"name": notetype,
						"css": cssContent.toString()
					}
				}
			};

			const cardTemplateResponse = await axios.post(url, cardTemplatePostData);
			if (cardTemplateResponse.data.error) {
				window.showErrorMessage('Error updating card template.');
				return;
			}

			const cardStylingResponse = await axios.post(url, cardStylingPostData);
			if (cardStylingResponse.data.error) {
				window.showErrorMessage('Error updating card styling.');
				return;
			}

			window.showInformationMessage('Card template updated successfully!');
		} catch (error) {
			console.error(error);
			window.showErrorMessage('Error updating card templates.');
		}
	});


	async function backupDirectory(folderName: string) {
		const workspaceFolders = workspace.workspaceFolders;
		const currentFolderUri = workspaceFolders![0].uri;
		const backupFolderName = ".backup";
		const backupFolderUri = Uri.joinPath(currentFolderUri, backupFolderName);
		const backupFolderExists = await workspace.fs.stat(backupFolderUri).then(stat => stat.type === FileType.Directory, () => false);
		if (backupFolderExists) {
			window.showInformationMessage(`Backup folder already exists at ${backupFolderUri.fsPath}`);
			return;
		}

		try {
			await workspace.fs.createDirectory(backupFolderUri);
			const sourceUri = Uri.joinPath(currentFolderUri, folderName);
			const targetUri = Uri.joinPath(backupFolderUri, folderName);
			await workspace.fs.copy(sourceUri, targetUri);
			window.showInformationMessage(`Backup created successfully at ${backupFolderUri.fsPath}`);
		} catch (error) {
			window.showErrorMessage(`Error creating backup: ${error}`);
		}
	}

	context.subscriptions.push(createTemplateDir, updateCurrentFile, syncNotetype);
}

// This method is called when your extension is deactivated
export function deactivate() { }
