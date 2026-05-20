const dns = require("node:dns");
const dotenv=require("dotenv")
const cors = require('cors')
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');



dotenv.config()
const uri = process.env.MONGODB_URI;
const app = express()
const PORT = process.env.PORT
app.use(cors()) 
app.use(express.json())

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    
    await client.connect();
    
const db =client.db('studyNook')
const addRoomsCollection=db.collection('addRooms')
const bookingCollection=db.collection('bookings')



app.get('/addroom',async(req,res)=>{
  
  const result=await addRoomsCollection.find().toArray();
  res.json(result)
})



app.post('/addroom',async(req,res)=>{
  const addroomData=req.body
    if (!Array.isArray(addroomData.amenities)) {
    addroomData.amenities = [];
  }
  console.log(addroomData)
  const result=await addRoomsCollection.insertOne(addroomData)
  res.json(result)
})

app.get('/room/:id',async(req,res)=>{
const {id}=req.params 
const result =await addRoomsCollection.findOne({_id:new ObjectId(id)})
  res.json(result)
})
app.post('/bookings',async(req,res)=>{
  const bookingData=req.body;
  const result=await bookingCollection.insertOne(bookingData)
  
res.json(result);
})


    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/',(req,res)=>{
res.send('Server is running fine!')
})

app.listen(PORT,()=>{
console.log(`server running on port ${PORT}`)
})









// const express = require('express')

// const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// // const { json } = require("node:stream/consumers");
// // dotenv.config()


// const uri = process.env.MONGODB_URI;
// // const app = express()
// const PORT = process.env.PORT



// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   }
// });
// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)
//     await client.connect();
//     // Send a ping to confirm a successful connection
//     await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
//     await client.close();
//   }
// }
// run().catch(console.dir);

// // async function run() {
// //   try {
    
// //     await client.connect();

// // const db=client.db('wanderlust')
// // const destinationCollection=db.collection('destinations')
// // const bookingCollection=db.collection('bookings')

// // app.get('/destination',async(req,res)=>{
// //   const result = await destinationCollection.find().toArray()
// //   res.json(result)
// // })

// // // app.post('/destination',async(req,res)=>{
// // //   const destinationData=req.body
// // //   console.log(destinationData)
// // //   const result = await destinationCollection.insertOne(destinationData)
// // //   res.json(result)

// // // })

// // // app.get('/destination/:id',async(req,res)=>{
// // //   const {id}=req.params
// // //   const result = await destinationCollection.findOne({_id:new ObjectId(id)})
// // //   res.json(result)
// // // })

// // // app.patch('/destination/:id',async(req,res)=>{
// // //   const {id}=req.params
  
// // //   const updatedData=req.body
// // //   const result =await destinationCollection.updateOne({_id:new ObjectId(id)},{$set:updatedData})
// // //   res.json(result)
// // // })
// // // app.delete('/destination/:id',async(req,res)=>{
// // //   const {id}=req.params;

  
// // //   const result =await destinationCollection.deleteOne({_id:new ObjectId(id)})
// // //   res.json(result)
// // // })

// // // app.post('/bookings',async(req,res)=>{
// // //   const bookingData=req.body;
// // //   const result=await bookingCollection.insertOne(bookingData)
// // //   res.json(result);
// // // })
  
// // // app.get('/bookings/:userId',async(req,res)=>{
// // //   const {userId}=req.params
// // //   const result = await bookingCollection.findOne({userId:userId}).toArray();
// // //   res.json(result)
// // // })

// // //     await client.db("admin").command({ ping: 1 });
// // //     console.log("Pinged your deployment. You successfully connected to MongoDB!");
// // //   } finally {
// // //     // Ensures that the client will close when you finish/error
// // //     // await client.close();
// // //   }
// // // }
// // // run().catch(console.dir);

