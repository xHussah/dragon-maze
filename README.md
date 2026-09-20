# 🐉 Dragon's Maze

**▶ Play it: https://d1czf247jnlvka.cloudfront.net**

<img width="1917" height="1137" alt="image" src="https://github.com/user-attachments/assets/54469dcf-7e67-464a-932d-71487638885f" />
<img width="1917" height="1137" alt="image" src="https://github.com/user-attachments/assets/53b14865-ad85-47d1-a1af-1c0491f71fc8" />
<img width="1917" height="1137" alt="image" src="https://github.com/user-attachments/assets/2bc9bcce-2500-457a-94bc-1aac16416540" />
<img width="1917" height="1140" alt="image" src="https://github.com/user-attachments/assets/9efccc86-15cf-49f7-accb-23f52d9291f8" />
<img width="1917" height="1138" alt="image" src="https://github.com/user-attachments/assets/1d98cb96-a4b0-42d8-8443-2272d1ab26cc" />
<img width="1917" height="1135" alt="image" src="https://github.com/user-attachments/assets/dac76a9d-30ff-476f-b9d0-848f1bbe6f98" />


## About the Game
Dragon's Maze is a browser-based grid game with 7 levels, from a small 5×5 grid to a 10×10 maze guarded by two dragons. Reach the golden door before the dragon catches you: move with the arrow keys, WASD or by swiping, and grab stars to freeze the dragon for a turn. The dragon only sees what is near it, remembers where it last saw you, and wanders when it loses you. Later levels add surprises: bonus stars, dragon speed bursts and fog of war.

The dragon is not scripted. It is controlled by a **Q-Learning agent** (reinforcement learning). Each level has its own agent, trained in a simulated copy of the game against different kinds of players: some rush to the door, some collect stars first, some wander randomly. The trained policies are stored on a cloud-hosted API, and the game downloads the right one at the start of each level. The **AGENT** box in the top bar shows how many of the dragon's moves come from it. In tests with scripted bot players, the trained dragon caught them 62.7% of the time on average, compared with 53.6% for a dragon that simply takes the shortest path. It is most dangerous on level 6 (34.8% → 91.2%), while on levels 3 and 5 it does worse than the shortest-path dragon.

<img width="1191" height="440" alt="image" src="https://github.com/user-attachments/assets/7c8f97ca-06bc-4e67-8e1f-d91e421025d3" />

## Architecture
The game runs entirely in the browser (HTML5 Canvas and JavaScript) and is hosted as static files on AWS S3, with Amazon CloudFront in front providing HTTPS. When a level starts, the game requests that level's trained Q-table from a FastAPI backend running on AWS Elastic Beanstalk. CloudFront forwards these requests, so the browser only talks to a single secure address. The Q-tables are produced offline by the training code in `backend/` and shipped with the API as JSON files. Docker Compose is used to run the backend locally.

## Project Structure
```
dragon-maze/
├── README.md
├── docker-compose.yml       Runs the backend locally 
├── frontend/
│   ├── index.html           
│   └── game.js              
├── backend/
│   ├── main.py              FastAPI server sends the trained policies to the game
│   ├── agent.py             The Q-Learning agent and its training script
│   ├── environment.py       A simulated copy of the game that the agent trains in
│   ├── policies/            The trained Q-tables, one JSON file per level (level_1 … level_7)
│   ├── requirements.txt     Python packages the server needs
│   ├── Dockerfile           Builds the backend for Docker
│   └── Procfile             Tells AWS how to start the server
└── tools/
    └── browser_eval.py      Plays the real game with bots to measure the dragon (source of the numbers above)
```

## Technologies Used
**Language & Framework:**
- Python, FastAPI
- JavaScript (HTML5 Canvas)

**Method:**
- Q-Learning (reinforcement learning)

**Platform:**
- AWS S3, CloudFront, Elastic Beanstalk
- Docker

## Developer
- Hussah Alotaibi

This project was completed in September 2026.
