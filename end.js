const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const expressJwt = require("express-jwt");
const bcrypt = require("bcrypt");
const mysql = require("mysql");
const _ = require("lodash");
const redis = require("redis");
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const axios = require("axios");
const dayjs = require("dayjs");









const database={
  mysqlHost:'mysql的ip',
  mysqlPassword:'mysql的密码',
  mysqlDatabase:'mysql的库名',
  redisHost:'redis的ip',
  redisPassword:'redis的密码'
}

const wx={
  appid:'微信开发者的appid',
  secret:'微信开发者的秘钥'
}















const nanoid = async () => {
  let { nanoid } = await import("nanoid");
  return nanoid();
};

var secret = bcrypt.hashSync("这是一个salt", 10);

const connection = mysql.createConnection({
  host: database.mysqlHost,
  port: "3306",
  user: "root",
  password: database.mysqlPassword,
  database: database.mysqlDatabase,
});
const { commandOptions } = redis;
const redisClient = redis.createClient({
  url: `redis://${database.redisHost}:6379`,
  username: "default",
  password: database.redisPassword,
});

redisClient.on("ready", () => {
  console.log("redis已经准备完毕");
});

redisClient.on("error", (err) => {
  console.log("redis发生了错误", err);
});
redisClient.connect();
connection.connect((err) => {
  if (err) {
    console.error("failed to connect to database, error: ", err);
    process.exit(1);
  }
  console.log("mysql连接成功");
});

function getJWT(uid, session_key) {
  return (
    "Bearer " +
    jwt.sign(
      {
        uid: uid,
        session_key: session_key,
      },
      secret,
      {
        expiresIn: 60 * 60 * 24,
      }
    )
  );
}

/**
 * @return {string} dateString  格式化后的当前时间字符串
 * @description 获取格式化的当前的时间字符串
 * @example let date = formatCurrentDate()
 * */
function formatCurrentDate() {
  return dayjs(new Date().toISOString()).format("YYYY-MM-DD HH:mm:ss");
}

//token验证
// app.use((req,res,next)=>{
//   const {headers:{Authorization:token},url}=req
//   if(!/login/.text(url)){
//     jwt.verify(token,secret,(err,data)=>{
//       if(err) return res.status(401).json({code:401,msg:'token验证失败'})
//     })
//   }
//   next()
// });

/**
 * @param {string} sql
 * @return {Promise} result
 * @description 封装成promise的mysql数据操作，只要写sql就行,如果出错会抛出错误，所以还要trycathc包裹一下
 * @example let result = await query("select * from table")
 *
 * */
function query(sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (err, result) => {
      if (err) {
        reject(err);
      }
      resolve(result);
    });
  });
}

/**
 * @param {'判断题' | '选择题'} type 这道题的类型
 * @param {object} i 装有整个题的对象
 * @return {string} option
 * @description 将一个题目的选项封装成#阻隔的option字符串
 */
function getOption(type, i) {
  return type != "判断题"
    ? Object.getOwnPropertyNames(i)
        .filter((i) => {
          return /option/.test(i);
        })
        .slice(0, i.columnnum)
        .map((j) => {
          return i[j];
        })
        .join("#")
    : "正确#错误";
}

function getAnswer(i, ...args) {
  //参数为1个的时候返回为#拼接后的答案，否则返回的是答案数组
  let result = [];
  if (arguments.length == 1) {
    if (i.datitype != "判断题") {
      // console.log(i)
      for (let index = 0; index < i.answer.length; index++) {
        result.push(i["option" + i.answer[index]]);
      }
    } else {
      result.push(i.answer);
    }
    return result.join("#");
  } else {
    if (i.datitype != "判断题") {
      for (let index = 0; index < i.answer.length; index++) {
        result.push(i["option" + i.answer[index]]);
      }
    } else {
      result.push(i.answer);
    }
    return result;
  }
}

setInterval(() => {
  async function a() {
    console.log("获取锁")
    let lock = await redisClient.get("updateQuestionLock");
    console.log(lock)
    if (!lock) {
      console.log("更新redis的question");
      await redisClient.set("updateQuestionLock", "lock");
      questionToRedis();
    }
  }
  a();
}, 10 * 60 * 1000); //10分钟执行一次

//将题目存入redis
// questionToRedis();
async function questionToRedis() {


  let questionBanks = await query(
    "select distinct coursetype from question_tbl"
  );
  let x = questionBanks.map((i) => i.coursetype);
  let id = [];
  let q = [];
  for (let i of x) {
    let length = await redisClient.sCard("question_tbl_" + i);
    let hasExist = await redisClient.sRandMemberCount(
      "question_tbl_" + i,
      length
    );
    hasExist
      .map((i) => JSON.parse(i))
      .forEach((i) => {
        id.push(i.id);
        q.push(i);
      });
  }
  // console.log(id)
  let result = await query("select * from question_tbl");
  result = result.filter((i) => id.indexOf(i.id) == -1);
  q.forEach((i) => {
    result.push(i);
  });
  let a = {};
  let map = questionBanks.map((i) => i.coursetype);
  for (let i of map) {
    a[i] = await query(
      `select count(1) ct from question_tbl where coursetype='${i}'`
    );
  }
  // console.log(a)
  // map.forEach(i=>{
  //   console.log(i)
  //   console.log()
  // })
  map.forEach(async (i) => {
    // console.log(`update questionbank_tbl set questionnum =${a[i][0].ct} `)
    await query(
      `update questionbank_tbl set questionnum =${a[i][0].ct} where bankname='${i}' `
    );
  });

  let obj = {};
  questionBanks.forEach((i) => {
    obj[i.coursetype] = [];
  });
  try {
    Object.getOwnPropertyNames(obj).forEach(async (i) => {
      await redisClient.del("question_tbl_" + i);
    });
  } catch (error) {
    console.log(error);
  }

  result.forEach((i) => {
    let list = {};
    Object.getOwnPropertyNames(i).forEach((j) => {
      list[j] = _.trim(i[j]);
    });
    obj[i.coursetype].push(JSON.stringify(list));
  });

  setTimeout(() => {
    questionBanks.forEach((i) => {
      redisClient
        .SADD("question_tbl_" + i.coursetype, obj[i.coursetype])
        .then((result) => {
          // console.log(result);
        })
        .catch((err) => {
          console.log(err);
        });
    });
    console.log("题库已导入");
  }, 1000);
}

// 假设你已经有了一个用于连接数据库的 connection 对象
// connection.query(sql, (err, result) => {...})

//向redis中写入排行榜，并且定期更新，不然每个人访问就去mysql拿数据计算一次，浪费资源了
//下面写的定时好像有问题，没生效，还是先直接执行第161行的代码算了

// let a=null
// a= setInterval(()=>{
//   try {
//     calculateRankingList();
//     clearInterval(a)
//     a=null
//   } catch (error) {
//     console.log( '\x1B[31m'+"设置排行榜发生错误"+'\x1B[37m')
//     console.log(error.message)
//   }
// },1000*60)

// calculateRankingList();
setInterval(() => {
  calculateRankingList();
  console.log("更新排行榜");
}, 5 * 60 * 1000); //5分钟更新一次
calculateRankingList()
async function calculateRankingList() {
  console.log(new Date().toISOString(), "重新计算排行榜");
  let userList=await query("select * from user_tbl")
  let normalList=await query(`
  select * from history_tbl t2 join (
    select userid,\`mode\`,coursetype,max(date) date from history_tbl where \`mode\`='普通模式' GROUP BY userid,\`mode\`,coursetype
  ) t1 on t2.userid = t1.userid and t1.date=t2.date and t2.\`mode\`='普通模式' order by t2.coursetype,t2.current_score DESC  
  `)
  // console.log(normalList)
  let normalObj={}
  for(let i of normalList){
    if(!normalObj[i.coursetype]){
      normalObj[i.coursetype]=[]
    }
    let user=userList.find(j=>{
      return j.userid==i.userid
    })
    // console.log(user)
    normalObj[i.coursetype].push({
      userId:i.userid,
      date:i.date,
      score:i.current_score,
      tier:i.current_tier,
      evaluation:i.evaluation,
      img:user.avatar,
      nickname:user.nickname
    })
  }
  // console.log(normalObj)
  let challengeList=await query(`
  select * from history_tbl t2 join (
    select t4.userid,t4.coursetype,max(t4.date) date,t4.current_score from history_tbl t4 join (
     select userid,coursetype,max(current_score) score from history_tbl where \`mode\`='挑战模式'
     group by userid,coursetype
    ) t3 on t4.current_score=t3.score and t3.userid=t4.userid and t3.coursetype=t4.coursetype group by t3.userid,t3.coursetype,score
  ) t1 on t2.userid=t1.userid and t1.coursetype=t2.coursetype and t1.date=t2.date
 order by t2.current_score DESC,t2.challenge_completion_time
  `)
  let challengeObj={}
  
  for(let i of challengeList){
    if(!challengeObj[i.coursetype]){
      challengeObj[i.coursetype]=[]
    }
    let user=userList.find(j=>{
      return j.userid==i.userid
    })
    challengeObj[i.coursetype].push({
      userId:i.userid,
      date:i.date,
      score:i.current_score,
      tier:i.current_tier,
      evaluation:i.evaluation,
      img:user.avatar,
      spendTime:i.challenge_completion_time,
      nickname:user.nickname
    })
  }
  // console.log(challengeObj)
 
//   let result = await query("select * from history_tbl ORDER by date,normal_answer_true,challenge_completion_time");
//   let questionBankList = await query(
//     "select distinct coursetype from history_tbl"
//   );
//   let userInfo = await query("select * from user_tbl");
//   let userObj = {};
//   userInfo.map((i) => {
//     userObj[i.userid] = {
//       ...i,
//     };
//   });
//   let set = new Set(questionBankList);
//   // console.log(set);
//   //默认数据库中的数据是已经按照时间顺序排序好的，如果不是，要再手动排序一下
//   let normalList = [];
//   let challengeList = [];
//   result.forEach((i) => {
//     if (i.mode == "普通模式") {
//       normalList.push(i);
//     } else if (i.mode == "挑战模式") {
//       challengeList.push(i);
//     }
//   });
//   let normalObj = {
//     // *[Symbol.iterator]() {
//     //   yield* Object.getOwnPropertyNames(this).map((i) => {
//     //     return this[i];
//     //   });
//     // },
//   };
//   let challengeObj = {
//     // *[Symbol.iterator]() {
//     //   yield* Object.getOwnPropertyNames(this).map((i) => {
//     //     return this[i];
//     //   });
//     // },
//   };

//   normalList.forEach((i) => {
//     //这里是数组里面的时间是乱序的
//     // if (!normalObj[i.userid]) {
//     //   //说明这个userid第一次出现
//     //   normalObj[i.userid][i.coursetype] = {
//     //     date: i.date,
//     //     score: i.current_score,
//     //     tier: i.current_tier,
//     //     evaluation: i.evaluation,
//     //   };
//     // } else {
//     //   if (!normalObj[i.userid][i.coursetype]) {
//     //     //说明这个userid的这个题库的数据第一次出现
//     //     normalObj[i.userid][i.coursetype] = {
//     //       date: i.date,
//     //       score: i.current_score,
//     //       tier: i.current_tier,
//     //       evaluation: i.evaluation,
//     //     };
//     //   } else { //第二次出现则需要比较一下时间

//     //   }
//     // }

//     if (!normalObj[i.coursetype]) {
//       normalObj[i.coursetype] = {};
//     }
//     //这里是按数据里的时间是已经顺序的,直接赋值就好，不需要任何判断
//     normalObj[i.coursetype][i.userid] = {
//       userId: i.userid,
//       date: i.date,
//       score: i.current_score,
//       tier: i.current_tier,
//       evaluation: i.evaluation,
//       img: userObj[i.userid].avatar,
//       nickname: userObj[i.userid].nickname,
//     };
//   });
//   challengeList.forEach((i) => {
//     if (!challengeObj[i.coursetype]) {
//       challengeObj[i.coursetype] = {};
//     }
//     challengeObj[i.coursetype][i.userid] = {
//       userId: i.userid,
//       date: i.date,
//       score: i.current_score,
//       tier: i.current_tier,
//       evaluation: i.evaluation,
//       img: userObj[i.userid].avatar,
//       nickname: userObj[i.userid].nickname,
//       spendTime: i.challenge_completion_time,
//     };
//   });
//   // console.log(challengeObj)
//   // console.log(challengeObj)
//   set.forEach((i) => {
//     normalObj[i.coursetype] = {
//       ...normalObj[i.coursetype],
//       *[Symbol.iterator]() {
//         yield* Object.getOwnPropertyNames(this).map((i) => {
//           return this[i];
//         });
//       },
//     };
//     challengeObj[i.coursetype] = {
//       ...challengeObj[i.coursetype],
//       *[Symbol.iterator]() {
//         yield* Object.getOwnPropertyNames(this).map((i) => {
//           return this[i];
//         });
//       },
//     };
//   });

//   // console.log(challengeObj)

//   for (let i in normalObj) {
//     normalObj[i] = Array.from(normalObj[i]);
//     normalObj[i].sort((a, b) => {
//       return b.score - a.score;
//     });
//   }
//   // console.log(normalObj);
//   for (let i in challengeObj) {
//     challengeObj[i] = Array.from(challengeObj[i]);
//     challengeObj[i].sort((a, b) => {
//       return b.score - a.score;
//     });
//   }
// console.log(challengeObj)
//现在normalObj结果如下
//console.log(normalObj);
/*
{
      '习概': [
        {
          userId: '7dae5608-785f-11ee-8bb7-00ff081f5c45',
          date: 2023-11-13T12:16:00.000Z,
          score: 124,
          tier: '黄金',
          evaluation: 'Good',
          img: 'http://tmp/AlciyoBi97yr3271ea16bc0bed6de436301b1d930377.png'
        }
      ],
      '马原': [
        {
          userId: '7dae5608-785f-11ee-8bb7-00ff081f5c45',
          date: 2023-11-13T12:16:53.000Z,
          score: 302,
          tier: '黄金',
          evaluation: 'Nice',
          img: 'http://tmp/AlciyoBi97yr3271ea16bc0bed6de436301b1d930377.png'
        },
        {
          userId: '7dae5608-785f--00ff081f5c45',
          date: 2023-11-13T12:17:26.000Z,
          score: 134,
          tier: '黄金',
          evaluation: 'OK',
          img: null
        }
      ],
      '近代史': [
        {
          userId: '-785f--00ff081f5c45',
          date: 2023-12-05T16:53:36.000Z,
          score: 206,
          tier: '',
          evaluation: '',
          img: null
        },
        {
          userId: '7dae5608-785f--00ff081f5c45',
          date: 2023-12-05T16:52:59.000Z,
          score: 203,
          tier: '',
          evaluation: '',
          img: null
        },
        {
          userId: '7dae5608-785f-11ee-8bb7-00ff081f5c45',
          date: 2023-11-13T12:17:57.000Z,
          score: 190,
          tier: '黄金',
          evaluation: 'GOD！',
          img: 'http://tmp/AlciyoBi97yr3271ea16bc0bed6de436301b1d930377.png'
        }
      ]
    }
  */

  //接下来存入redis
  await redisClient.del("normalRanking")
  await redisClient.del("challengeRanking")
  for (let i in normalObj) {
   
    await redisClient.hSet("normalRanking", i, JSON.stringify(normalObj[i]));
  }
  for (let i in challengeObj) {
    await redisClient.hSet(
      "challengeRanking",
      i,
      JSON.stringify(challengeObj[i])
    );
  }

  console.log("成功导入排行榜数据");
}

app.post("/add/user", function (req, res) {
  const thisnickname = req.body.nickname;
  const thisavatar = req.body.avatar;
  const thisusername = req.body.username;
  const thisregistertime = req.body.register_time;
  const thislogintime = req.body.login_time;
  const thisvxid = req.body.vx_id;
  const thisremark = req.body.remark;
  // 生成UUID作为用户ID 其实这个包准确的是叫生成nanoid
  let uuid = nanoid();
  // 插入用户信息到数据库
  const sql2 = `INSERT INTO user_tbl (userid,nickname,avatar,username,register_time,login_time,vx_id,remark) VALUES ('${uuid}','${thisnickname}' , '${thisavatar}' , '${thisusername}' ,'${thisregistertime}'  , '${thislogintime}' , '${thisvxid}' , '${thisremark}') `;
  connection.query(sql2, (err, result) => {
    if (result.length == 0 || err) {
      res.status(500).json("添加用户信息失败");
    } else {
      // 对用户信息进行微信验证
      const params = {
        appid: "your_appid", // 替换为你的微信公众平台appId
        secret: "your_secret", // 替换为你的微信公众平台secret

        jsapi_ticket: "your_jsapi_ticket", // 替换为你的微信公众平台jsapi_ticket  jsapi_ticket：是用来调用微信JS接口的票据，通常在调用微信JS接口时需要使用。
        noncestr: "your_noncestr", // 替换为你的微信公众平台noncestr  noncestr：随机字符串，长度为32个字符，通常在调用微信支付接口时需要使用。
        timestamp: "your_timestamp", // 替换为你的微信公众平台timestamp  timestamp：当前时间戳，通常在调用微信支付接口时需要使用。
        signature: "your_signature", // 替换为你的微信公众平台signature  signature：签名，通常在调用微信支付接口或其他需要安全认证的接口时需要使用
        code: "thisvxid", // 传递用户在微信中的code参数
      };
      axios
        .post("https://api.weixin.qq.com/sns/jscode2session", params)
        .then((response) => {
          // 微信验证成功，可以根据需要进行后续操作，如获取用户信息等
          console.log("微信验证成功", response.data);
          res.status(200).json(response.data); // 这里可以根据你的需要返回响应数据
        })
        .catch((error) => {
          // 微信验证失败或请求出错，可以根据需要进行错误处理
          console.error("微信验证失败", error);
          res.status(500).json("微信验证失败"); // 这里可以根据你的需要返回错误响应数据
        });
    }
  });
});

//登陆！！！！！！！！！！！！！！！！！！！！！！
app.post("/loginbytour", (req, res) => {
  //这个的uid由前端给出
  console.log("游客登录:", req.body);
  let token = getJWT(req.body.uid);
  res.json({ token: token });
});

app.post("/loginbyuser", async (req, res) => {
  //这里的uid应该是后端先去查询用户在不在，在的话去数据库里面那uid并返回，不再的话要新建用户信息
  try {
    const { code, nickName, avatarUrl } = req.body;
    // console.log(avatarUrl)
    console.log(req.body);
    // let token = getJWT(req.body.uid);
    let a = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${wx.appid}&secret=${wx.secret}&js_code=${code}&grant_type=authorization_code `,
      {
        method: "GET",
      }
    );
    let userObj = await a.json();
    console.log(userObj);
    const { openid, session_key, errcode, errmsg } = userObj;
    //注：这里不使用unionid而是使用openid
    if (errcode && errcode != 0) {
      res.status(500).json({
        message: "微信授权失败:" + errmsg,
      });
      return;
    }
    let result = await query(`select * from user_tbl where userid='${openid}'`);
    let jwt = getJWT(openid, session_key);
    if (result.length != 0) {
      await query(
        `update user_tbl set login_time='${formatCurrentDate()}' where userid='${openid}'`
      );

      // res.status(200).json({
      //   token: jwt,
      //   username: "谢毅",
      //   uid: "7dae5608-785f-11ee-8bb7-00ff081f5c45",
      //   avatar: avatarUrl,
      // });
      res.status(200).json({
        token: jwt,
        username: result[0].nickname,
        uid: openid,
        avatar: result[0].avatar,
      });
    } else {
      await query(
        `insert into user_tbl(userid,nickname,avatar,register_time,login_time) values('${openid}','${nickName}','${avatarUrl}','${formatCurrentDate()}','${formatCurrentDate()}')`
      );
      // await query(
      //   `insert into user_tbl(userid,nickname,avatar,register_time,login_time) values('7dae5608-785f-11ee-8bb7-00ff081f5c45','${nickName}','${avatarUrl}','${formatCurrentDate()}','${formatCurrentDate()}')`
      // );

      res.status(200).json({
        token: jwt,
        username: nickName,
        uid: openid,
        avatar: avatarUrl,
      });
      // res.status(200).json({
      //   token: jwt,
      //   username: "谢毅",
      //   uid: "7dae5608-785f-11ee-8bb7-00ff081f5c45",
      //   avatar: avatarUrl,
      // });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "登陆失败，请联系管理员" });
  }
});

//收藏夹！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！ //取消收藏的被/star 合并了
//OK
app.get("/starList", async (req, res) => {
  const { username, userId } = req.query;
  //req.query.username获取用户的username ,  userId 用户id
  let questionIdList = await redisClient.hGet("star", userId);
  console.log(questionIdList);
  if (questionIdList == null) {
    res.status(200).json({ questionList: [] });
  } else {
    questionIdList = JSON.parse(questionIdList);
    console.log(
      "查询收藏夹的sql：" +
        `select * from question_tbl where id in ('${questionIdList.join(
          "','"
        )}')`
    );
    let questionList = await query(
      `select * from question_tbl where id in ('${questionIdList.join("','")}')`
    );
    console.log(questionList);
    questionList = questionList.map((i) => {
      return {
        questionTitle: i.question,
        questionClass: i.datitype == "判断题" ? "判断题" : "选择题",
        option: getOption(i.datitype, i),
        correctAnswer: getAnswer(i, 1),
        isStar: true,
        whatQuestionBank: i.coursetype,
        questionId: i.id,
      };
    });

    // questionList = [
    //   {
    //     questionTitle:
    //       "古希腊学者欧布里德曾经提出一个悖论，其大意是：一粒谷粒不能成为谷堆，再加上一粒也不能成为谷堆；所以如果现有的谷粒数不成为谷堆，那么在这个基础上每次只加一粒谷粒，则谷堆一直不能形成，这个悖论被称为“谷堆悖论”。“谷堆悖论”的错误在于（）。",
    //     questionClass: "选择题",
    //     option:
    //       "只看到了主要矛盾，忽略了次要矛盾#只看到了共性，忽略了个性#只看到了量变，忽视了质变#只看到了偶然性，忽视了必然性 ", //使用#分割选项，可以让后端传过来就是这样的或者过传来后自己将他组成这样
    //     correctAnswer: "只看到了主要矛盾，忽略了次要矛盾", //这个我随便选的一个，不一定对
    //     isStar: true, //是否收藏
    //     whatQuestionBank: "马克思主义原理",
    //     questionId: "j9d1jdsa",
    //   },
    //   {
    //     questionClass: "判断题",
    //     questionTitle:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     correctAnswer: "正确",
    //     isStar: true,
    //     whatQuestionBank: "习近平新思想",
    //     questionId: "90jdad1d1dsa",
    //   },
    // ];
    console.log(questionList);
    res.json({ questionList: questionList });
  }
});

//题库获取！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！

//OK
app.get("/questionBankList", async (req, res) => {
  try {
    let result = await query("select bankname from questionbank_tbl ");
    res.json({
      questionBankList: result.map((i) => {
        return i.bankname;
      }),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//题库搜索题目获取 OK
app.get("/searchList", async (req, res) => {
  console.log("题库获取");
  try {
    questionBankName = req.query.questionBank;
    //  res.query.questionBank 题库名字
    // const sql = "SELECT * FROM dati.question_tbl;"
    // connection.query(sql, (err, result) => {
    //   if (result.length == 0 || err) {
    //     res.status(500).json("获取题库信息失败")
    //   }
    //   else {//查到该记录，获取用户成功
    //     res.status(200).json(result)
    //   }
    // })

    const result = await query(
      `select * from question_tbl where coursetype='${questionBankName}'`
    );
    let resultList = result.map((i) => {
      return {
        id: i.id,
        title: i.question,
        type: i.datitype,
        answer: i.answer,
        option: getOption(i.datitype, i),
      };
    });
    // console.log(resultList)
    //一次性获取所有题目
    // let list = [
    //   {
    //     //注这里id要确保和前面的已经拿过来的题目的id不要重合，所以可以用题目的自己的唯一id

    //     id: "1",
    //     title:
    //       "古希腊学者欧布里德曾经提出一个悖论，其大意是：一粒谷粒不能成为谷堆，再加上一粒也不能成为谷堆；所以如果现有的谷粒数不成为谷堆，那么在这个基础上每次只加一粒谷粒，则谷堆一直不能形成，这个悖论被称为“谷堆悖论”。“谷堆悖论”的错误在于（）。",
    //     type: "选择题",
    //     answer: "A",
    //     option: "这是A#这是B#这是C",
    //   },
    //   {
    //     id: "2",
    //     title:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "3",
    //     title:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "4",
    //     title:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "5",
    //     title:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "6",
    //     title: "这是第6题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "7",
    //     title: "这是第7题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "8",
    //     title: "这是第8题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "9",
    //     title: "这是第9题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "10",
    //     title: "这是第10题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "11",
    //     title: "这是第11题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "12",
    //     title: "这是第12题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "13",
    //     title: "这是第13题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "14",
    //     title: "这是第14题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "15",
    //     title: "这是第15题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "16",
    //     title: "这是第16题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "17",
    //     title: "这是第17题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "18",
    //     title: "这是第18题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "19",
    //     title: "这是第19题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "20",
    //     title: "这是第20题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "21",
    //     title: "这是第21题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "22",
    //     title: "这是第22题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "23",
    //     title: "这是第23题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "24",
    //     title: "这是第24题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "25",
    //     title: "这是第25题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "26",
    //     title: "这是第26题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "27",
    //     title: "这是第27题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "28",
    //     title: "这是第28题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    //   {
    //     id: "29",
    //     title: "这是第29题",
    //     type: "判断题",
    //     answer: "正确",
    //     option: "",
    //   },
    // ];

    //totalSearchQuestionNumber 是总共的所有的题目数量
    res.json({
      questionList: resultList,
      totalQuestionNumber: resultList.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//错题集！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！
//ok
app.get("/correctNoteBook", async (req, res) => {
  //req.query.username 用户名,req.query.questionBank 哪个题库 userId 用户ID
  //这里要的是谁的哪个题库的错题集
  const { username, questionBank, userId } = req.query;
  console.log(req.query);
  try {
    let data = await redisClient.hGet("correctNoteBook", userId);
    data = JSON.parse(data);
    // data={
    //   ...data,
    //   *[Symbol.iterator]() {
    //     yield* Object.getOwnPropertyNames(this).map((i) => {
    //       return this[i];
    //     });
    //   },
    // }
    // console.log(data)
    let questionIdList = [];
    for (let i in data) {
      questionIdList.push(i);
    }
    let questionList = await query(
      `select * from question_tbl where id in ('${questionIdList.join(
        "','"
      )}') and coursetype='${questionBank}'`
    );
    let list = [];
    let starList = await redisClient.hGet("star", userId);
    if (starList != null) {
      starList = JSON.parse(starList);
    } else {
      starList = [];
    }

    if (questionList.length != 0) {
      list = questionList.map((i) => {
        return {
          title: i.question,
          type: i.datitype == "判断题" ? "判断题" : "选择题",
          answer: getAnswer(i, 1),
          option: getOption(i.datitype, i),
          isStar: starList.includes(i.id),
          isShowAnswer: false,
          isChosen: [],
          questionId: i.id,
        };
      });
    }
    // let list = [
    //   {
    //     title:
    //       "古希腊学者欧布里德曾经提出一个悖论，其大意是：一粒谷粒不能成为谷堆，再加上一粒也不能成为谷堆；所以如果现有的谷粒数不成为谷堆，那么在这个基础上每次只加一粒谷粒，则谷堆一直不能形成，这个悖论被称为“谷堆悖论”。“谷堆悖论”的错误在于（）。",
    //     type: "选择题",
    //     answer: "A",
    //     option: "这是A#这是B#这是C#这是DDDD",
    //     isStar: false, //是否收藏
    //     isShowAnswer: false, //这个统一false
    //     isChosen: "null", //这个统一null，
    //     questionId: "9dj1p0d1",
    //   },
    //   {
    //     title:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     type: "判断题",
    //     answer: "正确",
    //     isStar: false,
    //     isShowAnswer: false,
    //     isChosen: "null",
    //     questionId: "9dj1p00i1jkdajosnd1",
    //   },
    // ];

    res.json({ questionList: list });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//ok
app.post("/star", async (req, res) => {
  //req.body.questionId 这是问题id, req.body.addOrRemove 如果是remove就是要取消收藏，如果是add就是要添加为收藏

  //req.body.username 用户名 userId用户ID
  try {
    const { questionId, addOrRemove, username, userId } = req.body;
    let data = [];
    console.log(questionId);
    try {
      data = await redisClient.hGet("star", userId);
      console.log(data);
      data = data == null ? [] : JSON.parse(data);
    } catch (error) {}
    let dataSet = new Set(data);
    if (addOrRemove === "add") {
      dataSet.add(questionId);
      data = Array.from(dataSet);
      await redisClient.hSet("star", userId, JSON.stringify(data));
    } else {
      dataSet.delete(questionId);
      data = Array.from(dataSet);
      await redisClient.hSet("star", userId, JSON.stringify(data));
    }
    res.send(200);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

//排行榜！！！！！！！！！！！！！ ok
app.get("/rankingList", async (req, res) => {
  //req.query.username 获取用户名
  //req.query.questionBank 获取数据库名
  //req.query.mode   normal或challenge
  //userId id

  const { username, questionBank, mode, userId } = req.query;
  let userInformation = null;
  if (req.query.mode == "normal") {
    let result = await redisClient.hGet("normalRanking", questionBank);
    result = JSON.parse(result);

    if (username != "游客" && !result) {
      userInformation = await query(
        `select * from user_tbl where userid='${userId}' `
      );
      return res.json({
        personList: [],
        userInformation: {
          id: userId,
          score: 0,
          nickname: userInformation[0].nickname,
          place: "无",
          img: userInformation[0].avatar,
          time: 0,
        },
      });
    }else if(username=='游客'&&!result){
      return res.json({
        personList: [],
        userInformation: {
          id: userId,
          score: 0,
          nickname: "游客",
          place: "无",
          img:"",
          time: 0,
        },
      });
    }
    
    result = result.map((i, index) => {
      return {
        id: i.userId,
        score: i.score,
        nickname: i.nickname,
        place: index + 1,
        img: i.img,
      };yo
    });
    // let list = [
    //   {
    //     id: "1",

    //     score: "1200",
    //     nickname: "巴啦啦小魔仙",
    //     place: "1",
    //   },
    //   {
    //     id: "2",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "2",
    //   },
    //   {
    //     id: "3",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "3",
    //   },
    //   {
    //     id: "4",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "4",
    //   },
    //   {
    //     id: "5",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "5",
    //   },
    //   {
    //     id: "6",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "6",
    //   },
    //   {
    //     id: "7",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "7",
    //   },
    //   {
    //     id: "8",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "8",
    //   },
    //   {
    //     id: "9",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "9",
    //   },
    //   {
    //     id: "10",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "10",
    //   },
    //   {
    //     id: "11",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "11",
    //   },
    //   {
    //     id: "12",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "12",
    //   },
    //   {
    //     id: "13",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "13",
    //   },
    //   {
    //     id: "14",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "14",
    //   },
    //   {
    //     id: "15",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "15",
    //   },
    //   {
    //     id: "16",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "16",
    //   },
    //   {
    //     id: "17",

    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "17",
    //   },
    // ];

    //注意这里是默认历史记录已经按时间排序完毕
    if (username != "游客") {
      let userHistory = await query(
        `select * from history_tbl where userid='${userId}' and mode='普通模式' and coursetype='${questionBank}' order by date`
      );
      userInformation = await query(
        `select * from user_tbl where userid='${userId}' `
      );

      if (userHistory.length != 0) {
        userHistory = userHistory[userHistory.length - 1];
        userInformation = {
          id: userId,
          score: userHistory.current_score,
          nickname: userInformation[0].nickname,
          place:
            result.findIndex((value, index) => {
              return value.id == userId;
            }) + 1,
          img: userInformation[0].avatar,
        };
      } else {
        userInformation = {
          id: userId,
          score: 0,
          nickname: userInformation[0].nickname,
          place: "无",
          img: userInformation[0].avatar,
        };
      }
    } else {
      userInformation = {
        id: userId,
        score: 0,
        nickname: "游客",
        place: "无",
        img: "",
      };
    }

    // userInformation = {
    //   id: "xxx",
    //   score: "200",
    //   nickname: "匿名",
    //   place: "18",
    // };
    // console.log(userInformation)
    console.log(result.slice(0, 100), userInformation);
    return res.json({
      personList: result.slice(0, 100),
      userInformation: userInformation,
    });
  } else {
    let result = await redisClient.hGet("challengeRanking", questionBank);
    result = JSON.parse(result);
    // console.log(result);
    if (username != "游客" && !result) {
      userInformation = await query(
        `select * from user_tbl where userid='${userId}' `
      );
      return res.json({
        personList: [],
        userInformation: {
          id: userId,
          score: 0,
          nickname: userInformation[0].nickname,
          place: "无",
          img: userInformation[0].avatar,
          time: 0,
        },
      });
    }else if(username=='游客'&&!result){
      return res.json({
        personList: [],
        userInformation: {
          id: userId,
          score: 0,
          nickname: "游客",
          place: "无",
          img:"",
          time: 0,
        },
      });
    }
    result = result.map((i, index) => {
      return {
        id: i.userId,
        score: i.score,
        nickname: i.nickname,
        place: index + 1,
        img: i.img,
        time: i.spendTime,
      };
    });
    if (username != "游客") {
      let userHistory = await query(
        `select * from history_tbl where userid='${userId}' and mode='挑战模式' and coursetype='${questionBank}' order by date`
      );
      userInformation = await query(
        `select * from user_tbl where userid='${userId}' `
      );

      // console.log(userHistory)
      if (userHistory.length != 0) {
        userHistory = userHistory[userHistory.length - 1];
        userInformation = {
          id: userId,
          score: userHistory.current_score,
          nickname: userInformation[0].nickname,
          place:
            result.findIndex((value, index) => {
              return value.id == userId;
            }) + 1,
          img: userInformation[0].avatar,
          time: userHistory.challenge_completion_time,
        };
      } else {
        userInformation = {
          id: userId,
          score: 0,
          nickname: userInformation[0].nickname,
          place: "无",
          img: userInformation[0].avatar,
          time: 0,
        };
      }
    } else {
      userInformation = {
        id: userId,
        score: 0,
        nickname: "游客",
        place: "无",
        img: "",
        time: 0,
      };
    }

    console.log(result);
    // let list = [
    //   {
    //     id: "1",
    //     time: "4分59秒",
    //     score: "1200",
    //     nickname: "巴啦啦小魔仙",
    //     place: "1",
    //   },
    //   {
    //     id: "2",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "2",
    //   },
    //   {
    //     id: "3",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "3",
    //   },
    //   {
    //     id: "4",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "4",
    //   },
    //   {
    //     id: "5",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "5",
    //   },
    //   {
    //     id: "6",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "6",
    //   },
    //   {
    //     id: "7",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "7",
    //   },
    //   {
    //     id: "8",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "8",
    //   },
    //   {
    //     id: "9",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "9",
    //   },
    //   {
    //     id: "10",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "10",
    //   },
    //   {
    //     id: "11",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "11",
    //   },
    //   {
    //     id: "12",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "12",
    //   },
    //   {
    //     id: "13",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "13",
    //   },
    //   {
    //     id: "14",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "14",
    //   },
    //   {
    //     id: "15",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "15",
    //   },
    //   {
    //     id: "16",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "16",
    //   },
    //   {
    //     id: "17",
    //     time: "3分27秒",
    //     score: "480",
    //     nickname: "上面的怎么没有全身变？",
    //     place: "17",
    //   },
    // ];
    // let userInformation = {
    //   id: "xxx",
    //   score: "200",
    //   nickname: "匿名",
    //   place: "18",
    //   time: "4分59秒",
    // };
    res.json({
      personList: result.slice(0, 100),
      userInformation: userInformation,
    });
  }
});

//普通模式！！！！！！！！！！！！！！！！！！！！！！！！！！！！！

//获取题目 ok
app.get("/normal", async (req, res) => {
  //req.query.username 是获取用户名  name是获取题库名 number是所需要的题目个数,userid
  const { username, name: bankname, number, userId } = req.query;
  // let uid = jwt.verify( req.headers.token,secret).uid //按道理讲这会解析出token中的数据对象中的uid, 这个uid是根据设备id和时间戳生成的，按道理讲是唯一的
  if (req.query.username == "游客") {
    let result = await redisClient.sRandMemberCount(
      "question_tbl_" + bankname,
      req.query.number
    );

    while (req.query.number != 1 && result.length < req.query.number) {
      result.push(await redisClient.sRandMember("question_tbl_" + bankname));
    }
    //
    // let list = [
    //   //根据number从题库中随机获取题目，
    //   {
    //     questionTitle:
    //       "古希腊学者欧布里德曾经提出一个悖论，其大意是：一粒谷粒不能成为谷堆，再加上一粒也不能成为谷堆；所以如果现有的谷粒数不成为谷堆，那么在这个基础上每次只加一粒谷粒，则谷堆一直不能形成，这个悖论被称为“谷堆悖论”。“谷堆悖论”的错误在于（）。",
    //     questionClass: "选择题",
    //     option:
    //       "只看到了主要矛盾，忽略了次要矛盾#只看到了共性，忽略了个性#只看到了量变，忽视了质变#只看到了偶然性，忽视了必然性 ", //使用#分割选项，可以让后端传过来就是这样的或者过传来后自己将他组成这样
    //     correctAnswer: "只看到了主要矛盾，忽略了次要矛盾", //这个我随便选的一个，不一定对
    //     isStar: false, //游客这个就默认false
    //     id: "9dasjoldi1",
    //   },
    //   {
    //     questionClass: "判断题",
    //     questionTitle:
    //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
    //     correctAnswer: "正确",
    //     isStar: false,
    //     id: "00damsld1",
    //   },
    //   {
    //     questionClass: "判断题",
    //     questionTitle: "在d9u1hjd0o1d1",
    //     correctAnswer: "正确",
    //     isStar: false,
    //     id: "hiaoshddiouka",
    //   },
    //   {
    //     questionClass: "判断题",
    //     questionTitle: "这是4",
    //     correctAnswer: "正确",
    //     isStar: false,
    //     id: "90u1d1ohjd",
    //   },
    //   {
    //     questionClass: "判断题",
    //     questionTitle: "这是5",
    //     correctAnswer: "正确",
    //     isStar: false,
    //     id: "8hd1iukdghbisa",
    //   },
    // ];
    res.json({
      questionList: result.map((i) => {
        i = JSON.parse(i);
        return {
          questionTitle: i.question,
          questionClass: i.datitype == "判断题" ? "判断题" : "选择题",
          correctAnswer: getAnswer(i),
          isStar: false,
          id: i.id,
          option: getOption(i.datitype, i),
        };
      }),
    });
  } else {
    //如果不是游客，且number不等于1，则要知道该用户在当前题库的分数

    try {
      let score = 0;
      if (number != 1) {
        let result = await query(
          `select * from history_tbl where userId='${userId}' and coursetype='${bankname}' and mode='普通模式'`
        );
        // console.log(
        //   `select * from history_tbl where userId='${userId}' and coursetype='${bankname}'`
        // );
        if (result.length != 0) {
          result = result.map((i) => {
            let obj = {};
            Object.getOwnPropertyNames(i).forEach((j) => {
              obj[j] = i[j];
            });
            return obj;
          });
          result.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          ); //数组的第一个就是最后一次记录
          score = result[0].current_score;

          // console.log(score);
        }
      }
      let list = await redisClient.sRandMemberCount(
        "question_tbl_" + bankname,
        number
      );
      while (number != 1 && list.length < req.query.number) {
        list.push(await redisClient.sRandMember("question_tbl_" + bankname));
      }
      list = list.map((i) => {
        return JSON.parse(i);
      });
      try {
        let userStarList = await redisClient.hGet("star", userId);
        userStarList = JSON.parse(userStarList);
        list = list.map((i) => {
          return {
            questionTitle: i.question,
            questionClass: i.datitype == "判断题" ? "判断题" : "选择题",
            option: getOption(i.datitype, i),
            correctAnswer: getAnswer(i),
            isStar: userStarList.indexOf(i.id) != -1,
            id: i.id,
          };
        });
      } catch (error) {
        console.log(list);
        list = list.map((i) => {
          return {
            questionTitle: i.question,
            questionClass: i.datitype == "判断题" ? "判断题" : "选择题",
            option: getOption(i.datitype, i),
            correctAnswer: getAnswer(i),
            isStar: false,
            id: i.id,
          };
        });
      }

      res.json({ questionList: list, score: score });
    } catch (error) {
      console.log(error.message);
      console.log(error);
      res.json({ message: error.message });
    }
  }
});

//ok
app.post("/score", async (req, res) => {
  console.log("普通模式结算");
  // req.body.username 获取用户名   name 题库名  normalInfo 数组 第一个是数量 第二个是分数
  //req.body.userId
  const { username, name: bankname, normalInfo, userId } = req.body;

  // console.log(normalInfo)
  // console.log(typeof normalInfo)
  // console.log(normalInfo[0])
  try {
    let result = await query(
      `select * from history_tbl where userId='${userId}' and coursetype='${bankname}' and mode='普通模式'`
    );
    result = result.map((i) => {
      let obj = {};
      Object.getOwnPropertyNames(i).forEach((j) => {
        obj[j] = i[j];
      });
      return obj;
    });
    result.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ); //数组的第一个就是最后一次记录
    // console.log(result)
    if (result.length == 0) {
      result.push({});
      result[0].current_score = 0;
    }

    await query(`insert into history_tbl (userid,date,coursetype,mode,current_score,current_tier,current_ranking,challenge_completion_time,evaluation,normal_answer_number,normal_answer_true,answer_accuracy)
  values ('${userId}','${dayjs(new Date().toISOString()).format(
      "YYYY-MM-DD HH:mm:ss"
    )}','${bankname}','普通模式',${
      result[0].current_score + normalInfo[1]
    },"",0,0,'',${normalInfo[0]},${(normalInfo[0] + normalInfo[1]) / 2},${
      Math.floor(
        ((normalInfo[0] + normalInfo[1]) / 2 / normalInfo[0]) * 10000
      ) / 100
    })
  `);
    res.status(200).send();
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});

//修改错题集记录
app.post("/updateCorrectionNoteBook", async (req, res) => {
  try {
    const { username, userId, questionId, correctOrError } = req.body;
    console.log(req.body);
    if (correctOrError == "error") {
      let result = await redisClient.hGet("correctNoteBook", userId);
      // console.log(result)
      if (result) {
        result = JSON.parse(result);
        result[questionId] = 0;
        await redisClient.hSet(
          "correctNoteBook",
          userId,
          JSON.stringify(result)
        );
      } else {
        let result = {};
        result[questionId] = 0;
        // console.log(result)
        await redisClient.hSet(
          "correctNoteBook",
          userId,
          JSON.stringify(result)
        );
      }
    } else {
      let result = await redisClient.hGet("correctNoteBook", userId);
      if (result) {
        result = JSON.parse(result);
        // console.log(result[questionId])
        if (result[questionId] || result[questionId] == 0) {
          if (result[questionId] == 2) delete result[questionId];
          else result[questionId]++;
        }
        // console.log(result)
        await redisClient.hSet(
          "correctNoteBook",
          userId,
          JSON.stringify(result)
        );
      }
    }
    res.status(200).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//挑战模式！！！！！！！！！！！
//ok
app.get("/challenge", async (req, res) => {
  // req.query.username 获取用户名 req.query.number 数量  一般情况就是300个
  //name 是库名
  //一次性获取number个题目，拟定300个
  const { username, number, userId, name: bankname } = req.query;
  let questionList = await redisClient.sRandMemberCount(
    "question_tbl_" + bankname,
    number
  );
  questionList = questionList.map((i) => {
    i = JSON.parse(i);
    let answer = [];
    if (i.datitype != "判断题") {
      answer = i.answer.split("").map((j) => {
        return i["option" + j];
      });
    } else {
      answer = [i.answer];
    }
    return {
      id: i.id,
      questionClass: i.datitype == "判断题" ? "判断题" : "选择题",
      questionTitle: i.question,
      option: getOption(i.datitype, i),
      correctAnswer: answer,
      hasAnswered: [],
    };
  });
  //
  // let list = [
  //   {
  //     id: "9u8dj1ilod",
  //     questionClass: "选择题",
  //     questionTitle:
  //       "以前在农村，秸秆对农民来说几乎是一个毫无价值的东西，往往通过焚烧来处理，而随着新能源研究的推进，秸秆作为发电和制沼的原料，其价值在某种程度上甚至超过了粮食。这说明（）。",
  //     option:
  //       "客体的价值不具有确定性#不同主体的评价创造了不同价值#价值是实践基础上确立的主体与客体之间一种创造性关系#价值随主体变化，而变化与客体本身无关",
  //     correctAnswer: "客体的价值不具有确定性",
  //     hasAnswered: "", //这个全都是空
  //   },
  //   {
  //     id: "0c1hiolqhc89a",
  //     questionClass: "判断题",
  //     questionTitle:
  //       "在社会主义建设取得了重大成就，社会主义制度有了长足进步之后，资本主义的进攻方式则往往转变为以“和平演变”为主。",
  //     hasAnswered: "",
  //     correctAnswer: "正确",
  //   },
  // ];

  res.json({ questionList: questionList });
});
//将结果记录 ok
app.post("/challengeResult", async (req, res) => {
  //如果是游客，就不会有这个请求出现
  //userId
  //req.body.username 用户名  req.body.totalNumber 题目总数  correctNumber 正确总数 spendTime 花费时间
  //
  try {
    const {
      username,
      userId,
      totalNumber,
      correctNumber,
      spendTime,
      name: bankname,
    } = req.body;
    console.log(req.body);
    // console.log(req.body)
    await query(`insert into history_tbl (date,userid,coursetype,mode,current_score,current_tier,current_ranking,challenge_completion_time,evaluation,normal_answer_number,normal_answer_true,answer_accuracy) 
    values ('${dayjs(new Date().toISOString()).format(
      "YYYY-MM-DD HH:mm:ss"
    )}','${userId}','${bankname}','挑战模式',${correctNumber},'等级',0,${spendTime},'评价',${totalNumber},${correctNumber},${
      correctNumber / totalNumber
    })`);

    res.status(200).send();
  } catch (error) {
    console.log("挑战模式提交结果失败:", error.message);
    res.status(500).json({ message: error.message });
  }
});

//个人界面！！！！！！！！！！！！1
app.get("/person", async (req, res) => {
  //req.query.username 用户名
  //req.query.userId 用户Id

  //想到一个直接统计出结果的sql
  /* 
    select * from history_tbl t1 join (
    select DATE(date) date1,MAX(TIME(date)) date2,userid,coursetype,`mode`
    from history_tbl
    group by userid,date1,coursetype,`mode`
    ) t2 on DATE(t1.date) = t2.date1 and time(t1.date)=t2.date2 and t1.userid = t2.userid and t1.coursetype=t2.coursetype
    and t1.`mode` = t2.`mode`    
   结果是每个用户的每天最后一次记录的不同模式的数据的列表
  
  
  */

  const { userId } = req.query;
  let nickname = await query(
    `select nickname from user_tbl where userid='${userId}'`
  );
  nickname = nickname[0].nickname;
  let history = await query(
    `select * from history_tbl where userid='${userId}' order by date desc`
  );

  let questinBank = await query(
    `select DISTINCT bankname from questionbank_tbl `
  );
  questinBank = questinBank.map((i) => {
    return i.bankname;
  });
  let range = [];
  if (history.length != 0) {
    history = history.map((i) => {
      let obj = {};
      Object.getOwnPropertyNames(i).forEach((j) => {
        obj[j] = i[j];
      });
      return obj;
    });

    let result = {};
    history.forEach((i) => {
      let date = i.date;
      date = dayjs(new Date(date).toISOString())
        .format("YYYY-MM-DD")
        .toString();
      if (Object.getOwnPropertyNames(result).length < 5) {
        if (!result[i.coursetype]) {
          result[i.coursetype] = {};
          result[i.coursetype]["普通模式"] = {};
          result[i.coursetype]["挑战模式"] = {};
          result[i.coursetype][i.mode][date] = i;
        } else {
          if (!result[i.coursetype][i.mode][date]) {
            result[i.coursetype][i.mode][date] = i;
          } else {
            if (
              new Date(result[i.coursetype][i.mode][date].date).toUTCString <
              new Date(i.date).toUTCString
            ) {
              result[i.coursetype][i.mode][date] = i;
            }
          }
        }
      }
    });

    for (const [key, value] of Object.entries(result)) {
      range.push({
        value: key,
        text: key,
        common: {
          categories: Object.getOwnPropertyNames(value["普通模式"])
            .slice(0, 5)
            .reverse(),
          series:
            Object.getOwnPropertyNames(value["普通模式"]).length != 0
              ? [
                  {
                    name: "分数",
                    style: "straight",
                    data: Object.getOwnPropertyNames(value["普通模式"])
                      .map((i) => {
                        return value["普通模式"][i].current_score;
                      })
                      .slice(0, 5)
                      .reverse(),
                  },
                ]
              : null,
        },
        challenge: {
          categories: Object.getOwnPropertyNames(value["挑战模式"])
            .slice(0, 5)
            .reverse(),
          series:
            Object.getOwnPropertyNames(value["挑战模式"]).length != 0
              ? [
                  {
                    name: "分数",
                    style: "straight",
                    data: Object.getOwnPropertyNames(value["挑战模式"])
                      .map((i) => {
                        return value["挑战模式"][i].current_score;
                      })
                      .slice(0, 5)
                      .reverse(),
                  },
                  {
                    index: 1,
                    name: "花费时间",
                    data: Object.getOwnPropertyNames(value["挑战模式"])
                      .map((i) => {
                        return value["挑战模式"][i].challenge_completion_time;
                      })
                      .slice(0, 5)
                      .reverse(),
                    style: "straight",
                  },
                ]
              : null,
        },
      });
    }
    // console.log(result);
  } else {
    range = questinBank.map((i) => {
      return {
        value: i,
        text: i,
        common: null,
        challenge: null,
      };
    });
  }
  //
  // let range = [
  //   {
  //     value: "马克思主义原理",
  //     text: "马克思主义原理",
  //     common: {
  //       categories: [
  //         //最近回答的5天中的每天的最后的分数情况
  //         "2021/11/1",
  //         "2021/11/2",
  //         "2021/11/3",
  //         "2021/11/4",
  //         "2021/11/5",
  //       ],
  //       series: [
  //         {
  //           name: "分数",
  //           data: [55, 306, 405, 362, 777],
  //           style: "straight",
  //         },
  //       ],
  //     },
  //     challenge: {
  //       categories: [
  //         "2021/11/2",
  //         "2021/11/5",
  //         "2021/11/7",
  //         "2021/11/9",
  //         "2021/11/12",
  //       ],
  //       series: [
  //         {
  //           name: "分数",
  //           data: [35, 36, 31, 33, 13],
  //           style: "straight",
  //         },
  //         {
  //           index: 1,
  //           name: "花费时间",
  //           data: [250, 233, 150, 259, 300],
  //           style: "straight",
  //         },
  //       ],
  //     },
  //   },
  //   {
  //     value: "毛泽东思想",
  //     text: "毛泽东思想",
  //     common: {
  //       categories: [
  //         "2021/11/1",
  //         "2021/11/2",
  //         "2021/11/3",
  //         "2021/11/4",
  //         "2021/11/5",
  //       ],
  //       series: [
  //         {
  //           name: "分数",
  //           data: [35, 36, 31, 33, 13],
  //           style: "straight",
  //         },
  //       ],
  //     },
  //     challenge: {
  //       categories: [
  //         "2021/11/2",
  //         "2021/11/5",
  //         "2021/11/7",
  //         "2021/11/9",
  //         "2021/11/12",
  //       ],
  //       series: [
  //         {
  //           name: "分数",
  //           data: [35, 36, 31, 33, 13],
  //           style: "straight",
  //         },
  //         {
  //           index: 1,
  //           name: "花费时间",
  //           data: [250, 233, 150, 259, 300],
  //           style: "straight",
  //         },
  //       ],
  //     },
  //   },
  //   {
  //     value: "中国近代史",
  //     text: "中国近代史", //如果没有就这样设为null
  //     common: null,
  //     challenge: null,
  //   },
  // ];
  res.json({ range, nickname });
});

//ok
app.post("/changeNickname", async (req, res) => {
  //req.body.nickname 要修改的昵称，username 用户名 userId
  try {
    const { nickname, userId, username } = req.body;
    console.log(req.body);
    await query(
      `update user_tbl set nickname='${nickname}' where userid='${userId}'`
    );
    console.log("修改成功");
    res.status(200).send();
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

//OK
app.post("/changePicture", async (req, res) => {
  //req.body.nickname 要修改的昵称，username 用户名 userId
  try {
    const { nickname, userId, username, url } = req.body;
    console.log(req.body);
    await query(`update user_tbl set avatar='${url}' where userid='${userId}'`);
    console.log("修改成功");
    res.status(200).send();
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

app.post("/questionList", async (req, res) => {
  try {
    // console.log(req.body)
    let questionList = req.body;

    // console.log(questionList)
    // console.log(typeof questionList)
    // console.log(questionList.length)
    function judge(i, a, type) {
      if (type == "判断题") {
        return a == "optionA" ? '"正确"' : a == "optionB" ? '"错误"' : "NULL";
      }
      if (i[a] != undefined) {
        return `"${i[a]}"`;
      } else {
        return "NULL";
      }
    }
    // console.log(questionList[0])
    questionList = questionList.map((i) => {
      return `('${i.id}','${i.coursetype}','${i.datitype}',${i.columnnum},'${
        i.question
      }',${judge(i, "optionA", i.datitype)},${judge(
        i,
        "optionB",
        i.datitype
      )},${judge(i, "optionC", i.datitype)},${judge(
        i,
        "optionD",
        i.datitype
      )},${judge(i, "optionE", i.datitype)},${judge(
        i,
        "optionF",
        i.datitype
      )},${judge(i, "optionG", i.datitype)},${judge(
        i,
        "optionH",
        i.datitype
      )},${judge(i, "optionI", i.datitype)},${judge(
        i,
        "optionJ",
        i.datitype
      )},0,0,'${
        i.answer == "true" ? "正确" : i.answer == "false" ? "错误" : i.answer
      }')`;
    });
    // console.log(questionList[0])
    let sql = `insert into question_tbl (id,coursetype,datitype,columnnum,question,optionA,optionB,optionC,optionD,optionE,optionF,optionG,optionH,optionI,optionJ,Anum,Bnum,answer) values ${questionList.join(
      ","
    )} `;
    // console.log(sql)
    await query(sql);
    //同步题目数量
    let questionBanks = await query(
      "select distinct coursetype from question_tbl"
    );
    let a = {};
    let map = questionBanks.map((i) => i.coursetype);
    for (let i of map) {
      a[i] = await query(
        `select count(1) ct from question_tbl where coursetype='${i}'`
      );
    }
    // console.log(a)
    // map.forEach(i=>{
    //   console.log(i)
    //   console.log()
    // })
    map.forEach(async (i) => {
      // console.log(`update questionbank_tbl set questionnum =${a[i][0].ct} `)
      await query(
        `update questionbank_tbl set questionnum =${a[i][0].ct} where bankname='${i}' `
      );
    });
    let lock = await redisClient.get("updateQuestionLock");
    if (lock) {
      await redisClient.del("updateQuestionLock");
    }
    // await query()
    res.status(200).json({
      message: "成功",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: error.message,
    });
  }
});
//添加题目信息
app.post("/add/question", async (req, res) => {
  try {
    const thiscoursetype = req.body.coursetype;
    const thistype = req.body.type;
    const thiscolumn = req.body.columnnum;
    const thisquestion = req.body.title;
    const thisimg = req.body.img;
    const thisanswer = req.body.correctAnswer;
    var op = [];
    var index;
    for (index = 0; index < thiscolumn; index++) {
      switch (index) {
        case 0:
          op[index] = "'" + req.body.optionA + "'";
          break;
        case 1:
          op[index] = "'" + req.body.optionB + "'";
          break;
        case 2:
          op[index] = "'" + req.body.optionC + "'";
          break;
        case 3:
          op[index] = "'" + req.body.optionD + "'";
          break;
        case 4:
          op[index] = "'" + req.body.optionE + "'";
          break;
        case 5:
          op[index] = "'" + req.body.optionF + "'";
          break;
        case 6:
          op[index] = "'" + req.body.optionG + "'";
          break;
        case 7:
          op[index] = "'" + req.body.optionH + "'";
          break;
        case 8:
          op[index] = "'" + req.body.optionI + "'";
          break;
        case 9:
          op[index] = "'" + req.body.optionJ + "'";
          break;
      }
    }
    for (; index < 10; index++) {
      op[index] = null;
    }
    var num = [];
    for (index = 0; index < 10; index++) {
      num[index] = 0;
    }
    const id = await nanoid();
    const sql2 =
      `INSERT INTO question_tbl (id,coursetype,datitype,columnnum,question,img,optionA,optionB,optionC,optionD,optionE,` +
      `optionF,optionG,optionH,optionI,optionJ,Anum,Bnum,Cnum,Dnum,Enum,Fnum,Gnum,Hnum,Inum,Jnum,answer) VALUES` +
      `('${id}','${thiscoursetype}','${thistype}','${thiscolumn}','${thisquestion}','${thisimg}',${op[0]},${op[1]},${op[2]},` +
      `${op[3]},${op[4]},${op[5]},${op[6]},${op[7]},${op[8]},${op[9]},'${num[0]}','${num[1]}','${num[2]}','${num[3]}','${num[4]}',` +
      `'${num[5]}','${num[6]}','${num[7]}','${num[8]}','${num[9]}','${thisanswer}')`;
    console.log(sql2);
    await query(sql2);
    let questionBanks = await query(
      "select distinct coursetype from question_tbl"
    );
    let a = {};
    let map = questionBanks.map((i) => i.coursetype);
    for (let i of map) {
      a[i] = await query(
        `select count(1) ct from question_tbl where coursetype='${i}'`
      );
    }
    // console.log(a)
    // map.forEach(i=>{
    //   console.log(i)
    //   console.log()
    // })
    map.forEach(async (i) => {
      // console.log(`update questionbank_tbl set questionnum =${a[i][0].ct} `)
      await query(
        `update questionbank_tbl set questionnum =${a[i][0].ct} where bankname='${i}' `
      );
    });
    let lock = await redisClient.get("updateQuestionLock");
    if (lock) {
      await redisClient.del("updateQuestionLock");
    }
    res.status(200).send();
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});
//删除题库  //一般情况下禁用这个
app.delete("/questionBank", async (req, res) => {
  try {
    const { name: bankname } = req.body;
    console.log("收到删除请求");
    console.log(bankname);
    // await query(`delete from questionbank_tbl where bankname='${bankname}'`)
    // await query(`delete from question_tbl where coursetype='${bankname}'`)
    // await query(`delete from history_tbl where coursetype='${bankname}'`)
    res.status(200).send();
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});

app.listen(3000, () => {
  console.log("监听3000端口");
});
