const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors')({origin: true});
const puppeteer = require('puppeteer');
const { Client } = require('@notionhq/client');
const logger = require('firebase-functions/logger');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { uploadBytes }=require("@firebase/storage");

admin.initializeApp({
  storageBucket: 'notionbear-3e1e0.appspot.com' 
});

const db = admin.firestore();
const storage = getStorage(); 
const bucket = admin.storage().bucket(); 



exports.getWorkspaceByIdAndSaveDocuments = functions.https.onRequest(async (request, response) => {
  cors(request, response, async () => {
  response.set('Access-Control-Allow-Origin', '*');
  if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET');
      response.set('Access-Control-Allow-Headers', 'Content-Type');
      response.set('Access-Control-Max-Age', '3600');
      response.status(204).send('');
      return;
  }

  const workspaceId = request.query.workspaceId;
  if (!workspaceId) {
      return response.status(400).send({ error: 'Missing workspaceId in query parameters.' });
  }

  try {
      const workspaceSnapshot = await db.collection('workspaces').where('workspaces_id', '==', workspaceId).get();
      if (workspaceSnapshot.empty) {
          return response.status(404).send({ error: 'Workspace not found.' });
      }

      const workspaceData = workspaceSnapshot.docs[0].data();

      console.log('Workspace data:', workspaceData);

      const fileName = `${workspaceId}.json`; // Assuming the file name is the workspaceId

      console.log('getting file from storage' , fileName);
      
      const fileBuffer = await getFileFromStorageToParse(fileName);

      if (!fileBuffer) {
          return response.status(404).send('JSON file not found in Firebase Storage.');
      }

      const documentDataArray = JSON.parse(fileBuffer.toString());
      await saveDocuments(documentDataArray, workspaceData);

      return response.status(200).send({ message: 'Documents saved successfully.' });
  } catch (error) {
      console.error('Error processing request:', error);
      return response.status(500).send({ error: 'Failed to process request.' });
  }
})
});

async function getFileFromStorageToParse(fileName) {
  try {
      const file = storage.bucket(bucketName).file(`notion_data/${fileName}`);
      const [fileExists] = await file.exists();
      if (!fileExists) return null;
      const [buffer] = await file.download();
      return buffer;
  } catch (error) {
      logger.error('Error downloading file from Firebase Storage:', error);
      return null;
  }
}

async function saveDocuments(documentDataArray, workspaceData) {
  const batch = db.batch();
  documentDataArray.forEach(docData => {
      // Convert any nested arrays within docData to JSON strings
      const processedDocData = convertNestedArraysToStrings(docData);

      const docRef = db.collection('notion_documents').doc(); // Create a new doc with a generated ID
      batch.set(docRef, {
          ...processedDocData,
          projectId: workspaceData.projectId,
          workspaces_id: workspaceData.workspaces_id,
          userId: workspaceData.userId
      });
  });
  await batch.commit();
}


function convertNestedArraysToStrings(obj) {
  if (obj === null || typeof obj !== 'object') {
      return obj;
  }

  const newObj = {};
  for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) {
          // Check if any item is an array itself, indicating a nested array
          if (value.some(item => Array.isArray(item))) {
              // Convert the entire array to a JSON string to avoid nested arrays
              console.log(`Converting nested array at key ${key} to string`);
              newObj[key] = JSON.stringify(value);
          } else {
              // Regular array, but check each item for objects that might contain nested arrays
              newObj[key] = value.map(item => 
                  typeof item === 'object' ? convertNestedArraysToStrings(item) : item);
          }
      } else if (typeof value === 'object') {
          // Recursive call for nested objects
          newObj[key] = convertNestedArraysToStrings(value);
      } else {
          newObj[key] = value;
      }
  }
  return newObj;
}



exports.processFileAndUpload = functions.https.onRequest(async (request, response) => {
  cors(request, response, async () => {

  const {fileName, assistantId} = request.query;

  if (!fileName || !assistantId) {
    response.status(400).send('Missing fileName or assistantId in query parameters.');
    return;
  }

  console.log(`{fileName, assistantId}`, {fileName, assistantId});

  const fileBuffer = await getFileFromStorage(fileName);

  if (!fileBuffer) {
    response.status(404).send('File not found in Firebase Storage.');
    return;
  }

  try {
    const uploadResult = await uploadFileToAssistant(fileBuffer, assistantId);
    logger.info('Upload result:', uploadResult);
    response.send(uploadResult);
  } catch (error) {
    logger.error('Error uploading file:', error);
    response.status(500).send('Failed to upload file to assistant.');
  }

});

});




async function getFileFromStorage(fileName) {
  try {
    console.log('before', `/notion_data/${fileName.trim()}`);
    const file = storage.bucket(bucketName).file(`notion_data/${fileName.trim()}`);
    console.log('File path', file);

    const [fileExists] = await file.exists();
    if (!fileExists) return null;

    const [buffer] = await file.download();
    return buffer;
  } catch (error) {
    logger.error('Error downloading file from Firebase Storage:', error);
    return null;
  }
}

async function uploadFileToAssistant(file, assistantId) {
  const apiUrl = "https://chatgpt-b7ep-1luw.onrender.com/create-assistant-with-upload";
  const formData = new FormData();
  formData.append("files", file, {filename: "file.json"});

  const response = await fetch(apiUrl, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(`Failed to upload: ${response.statusText}`);
  return response.json();
}



const deleteApiUrl = "https://chatgpt-b7ep-1luw.onrender.com/delete-assistant";

exports.deleteAssistant = functions.https.onRequest(async (request, response) => {
   
  cors(request, response, async () => {

    const {assistantId} = request.query;

    if (!assistantId) {
        return response.status(400).send('Missing assistantId in query parameters.');
    }

    try {
        // Delete the assistant by making a POST request to the Flask API
        const deleteResponse = await deleteAssistant(assistantId);

        // Sending the API's response back to the client
        response.send(deleteResponse);
    } catch (error) {
        logger.error('Error deleting assistant:', error);
        response.status(500).send('Failed to delete assistant.');
    }

  });

});

async function deleteAssistant(assistantId) {
    const response = await fetch(deleteApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantId }),
    });
    if (!response.ok) {
        throw new Error(`Failed to delete: ${response.statusText}`);
    }
    return response.json();
}


exports.scrapeDownloadURL = functions.runWith({
  timeoutSeconds: 120,
  memory: '1GB'
}).https.onRequest(async (req, res) => {
  // Check if the query parameter `url` is present
  const targetURL = req.query.url;
  if (!targetURL) {
    res.status(400).send('No URL provided');
    return;
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    // Navigate to the provided URL
    await page.goto(targetURL, {waitUntil: 'networkidle2'});

    // Scrape the download URL
    const downloadURL = await page.evaluate(() => {
      const anchor = document.querySelector('a.input.popsok');
      return anchor ? anchor.href : null;
    });

    await browser.close();

    // Return the scraped URL
    if (downloadURL) {
      res.status(200).send({downloadURL});
    } else {
      res.status(404).send('Download URL not found');
    }
  } catch (error) {
    await browser.close();
    res.status(500).send(`Error scraping the URL: ${error.message}`);
  }
});



async function uploadImageToFirbaseAndGetURL(imageObject) {
  if (!imageObject || !imageObject.file || !imageObject.file.url) {
    console.error("No image URL provided");
    return "";
  }
  try {
    const response = await fetch(imageObject.file.url);
    if (!response.ok) throw new Error("Network response was not ok");
    const imageBuffer = await response.buffer();
    const filename = `images/image_${new Date().getTime()}`;
    const file = bucket.file(filename);
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg' 
      }
    });
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491' 
    });
    return url;
  } catch (error) {
    console.error("Error uploading image to Firebase:", error);
    return ""; 
  }
}



exports.syncNotionData = functions.runWith({
  timeoutSeconds: 540,
  memory: '2GB',
}).firestore.document('syncBatch/{batchId}').onCreate(async (snap, context) => {
  const { access_token, dublicateTempID, workspaceId } = snap.data();


  console.log('access_token', access_token);
  console.log('dublicateTempID', dublicateTempID);
  console.log('workspaceId', workspaceId);


  const customNotion = new Client({ auth: access_token });
  let allPagesData = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await customNotion.databases.query({
      database_id: dublicateTempID,
      start_cursor: startCursor,
      page_size: 100,
    });

    const pagesDataPromises = response.results.map(async page => {
      // Fetching all block content for each page
      const content = await fetchAllBlocks(page.id, customNotion);

      // Fetching image URLs
      const ArticleImage = page.properties["Article_or_Item_Image"]?.files?.[0]
        ? await uploadImageToFirbaseAndGetURL(page.properties["Article_or_Item_Image"].files[0])
        : "";
      const Author_Image = page.properties["Agent_or_Author_Image"]?.files?.[0]
        ? await uploadImageToFirbaseAndGetURL(page.properties["Agent_or_Author_Image"].files[0])
        : "";
      const Collections_Image = page.properties["Category_Image"]?.files?.[0]
        ? await uploadImageToFirbaseAndGetURL(page.properties["Category_Image"].files[0])
        : "";

     
     
      return {
        id: page.id,
        title: page.properties["Article_or_Item_Title"]?.title?.[0]?.plain_text || "",
        Status: page.properties?.Status?.status?.name || "",
        Description: page.properties["Article_or_Item_Description"]?.rich_text?.[0]?.plain_text || "",
        Featured: page.properties["Featured (max 5)"]?.select?.name || "",
        Author: page.properties.Agent_or_Author?.select?.name || "",
        Author_Description: page.properties.Agent_or_Author_Description?.rich_text?.[0]?.plain_text || "",
        Collection: page.properties.Categories?.multi_select?.map(select => select.name)?.[0] || "",
        Category:page.properties.Categories?.multi_select?.map(select => select.name)?.[0] || "",
        Collections_Description: page.properties.Category_Description?.rich_text?.[0]?.plain_text || "",
        Position: page.properties.Position?.number || 0,
        Item_CTA_Link: page.properties.Item_CTA_Link?.rich_text?.[0]?.plain_text || "",
        Item_CTA_Title: page.properties.Item_CTA_Title?.rich_text?.[0]?.plain_text || "",
        Item_Price: page.properties.Item_Price?.rich_text?.[0]?.plain_text || "",
        Item_CTA_Text: page.properties.Item_CTA_Text?.rich_text?.[0]?.plain_text || "",
        SEO_Title: page.properties.SEO_Title?.rich_text?.[0]?.plain_text || "",
        SEO_Tags: page.properties.SEO_Tags?.multi_select?.map(tag => tag.name)?.join(", ") || "",
        SEO_Description: page.properties.SEO_Description?.rich_text?.[0]?.plain_text || "",
        lastEditTime: page.last_edited_time,
        ArticleImage,
        url: page.url,
        Author_Image,
        Collections_Image,
        content, 
      };
    });

    const pagesData = await Promise.all(pagesDataPromises);
    allPagesData.push(...pagesData);
    hasMore = response.has_more;
    startCursor = response.next_cursor;

    if (hasMore) await new Promise(resolve => setTimeout(resolve, 334));
  }

  const pagesJson = JSON.stringify(allPagesData);

  console.log('pagesJson', pagesJson);
  const file = bucket.file(`notion_data/${workspaceId}.json`);

  await file.save(pagesJson, {
    metadata: {
      contentType: 'application/json',
    },
  });

  console.log(`Successfully synced and saved data for workspaceId: ${workspaceId}`);


  await deleteExistingDocuments(workspaceId);

 
  await sendRequestToGetWorkspace(workspaceId);


  await db.collection('syncBatch').doc(context.params.batchId).delete();

  console.log(`Deleted processed document with ID: ${context.params.batchId}`);
});


async function deleteExistingDocuments(workspaceId) {
  const querySnapshot = await db.collection('notion_documents').where('workspaces_id', '==', workspaceId).get();
  querySnapshot.forEach(async (doc) => {
    await db.collection('notion_documents').doc(doc.id).delete();
  });
  console.log(`Deleted existing documents for workspaceId: ${workspaceId}`);
}

async function sendRequestToGetWorkspace(workspaceId) {
  const requestURL = `https://us-central1-notionbear-3e1e0.cloudfunctions.net/getWorkspaceByIdAndSaveDocuments?workspaceId=${workspaceId}`;
  const response = await fetch(requestURL, { method: 'GET' });
  if (response.ok) {
    console.log(`Request sent successfully for workspaceId: ${workspaceId}`);
  } else {
    console.error(`Failed to send request for workspaceId: ${workspaceId}, status: ${response.status}`);
  }
}



async function fetchAllBlocks(pageId, notionClient) {
  let blockContent = [];
  let cursor;

  do {
    const { results, next_cursor } = await notionClient.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });
    blockContent.push(...results);
    cursor = next_cursor;
  } while (cursor);

 return blockContent;
}

