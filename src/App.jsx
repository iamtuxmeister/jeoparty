import React, { useState, useEffect, useReducer, useRef, useMemo } from 'react';
import { X, Check, Info, HelpCircle, Award, Monitor, Upload, Users, Settings, Clock, Volume2 } from 'lucide-react';

// --- CONSTANTS ---
const CHANNEL_NAME = 'jeoparty_channel_v1';
const TIME_UP_SOUND = 'times-up.mp3'; // Generic Buzzer

// --- CSV PARSER HELPER ---
const parseCSV = (text) => {
  // FIX: Added closing slash to the regex: /\r?\n/
  const lines = text.split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  const requiredFields = ['category', 'value', 'question', 'answer'];
  if (!requiredFields.every(f => headers.includes(f))) {
    throw new Error(`CSV missing required headers: ${requiredFields.join(', ')}`);
  }

  const rawClues = [];
  
  // Simple regex for CSV parsing that handles quotes
  const parseLine = (line) => {
    const result = [];
    let startValueIndex = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuotes = !inQuotes;
      else if (line[i] === ',' && !inQuotes) {
        let val = line.substring(startValueIndex, i).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/""/g, '"');
        result.push(val);
        startValueIndex = i + 1;
      }
    }
    let lastVal = line.substring(startValueIndex).trim();
    if (lastVal.startsWith('"') && lastVal.endsWith('"')) lastVal = lastVal.slice(1, -1).replace(/""/g, '"');
    result.push(lastVal);
    return result;
  };

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseLine(lines[i]);
    const clue = {};
    headers.forEach((h, idx) => clue[h] = row[idx]);
    if (clue.category && clue.value && clue.question && clue.answer) {
      rawClues.push(clue);
    }
  }

  // Group by Category
  const categoriesMap = {};
  rawClues.forEach((c, index) => {
    if (!categoriesMap[c.category]) {
      categoriesMap[c.category] = { id: index, title: c.category, clues: [] };
    }
    categoriesMap[c.category].clues.push({
      id: `clue-${index}`,
      value: parseInt(c.value.replace(/[^0-9]/g, '')) || 0,
      question: c.question,
      answer: c.answer
    });
  });

  // Sort clues by value and take top 5, take top 6 categories
  const categories = Object.values(categoriesMap)
    .slice(0, 6)
    .map(cat => {
      cat.clues = cat.clues.sort((a, b) => a.value - b.value).slice(0, 5);
      // Fill missing slots if any (simple fallback)
      while(cat.clues.length < 5) {
        cat.clues.push({ id: Math.random(), value: (cat.clues.length + 1) * 200, question: "N/A", answer: "N/A" });
      }
      return cat;
    });

  return categories;
};

// --- STATE MANAGEMENT ---

const initialState = {
  role: 'SETUP', // SETUP, HOST, BOARD
  teams: [{ id: 1, name: 'Team 1', score: 0 }],
  categories: [],
  activeClue: null,
  answeredClues: [],
  showAnswer: false,
  gameStarted: false,
  timer: 5,
  isTimerRunning: false,
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'INIT_GAME':
      return { 
        ...state, 
        role: 'HOST', 
        categories: action.payload.categories, 
        teams: action.payload.teams,
        gameStarted: true // Game is now started!
      };
    case 'SYNC_STATE':
      // Used by the Board to sync with Host
      // The payload contains the complete state (including categories and gameStarted: true)
      return { ...state, ...action.payload };
    case 'SELECT_CLUE':
      return { 
        ...state, 
        activeClue: action.payload, 
        showAnswer: false,
        timer: 5, // Reset timer on new clue
        isTimerRunning: false 
      };
    case 'REVEAL_ANSWER':
      return { ...state, showAnswer: true, isTimerRunning: false };
    case 'CLOSE_CLUE':
      return {
        ...state,
        activeClue: null,
        answeredClues: [...state.answeredClues, state.activeClue.id],
        showAnswer: false,
        isTimerRunning: false
      };
    case 'UPDATE_SCORE':
      return {
        ...state,
        teams: state.teams.map(t => 
          t.id === action.payload.teamId 
            ? { ...t, score: t.score + action.payload.points }
            : t
        )
      };
    case 'SET_ROLE':
      return { ...state, role: action.payload };
    case 'START_TIMER':
      return { ...state, isTimerRunning: true, timer: 5 };
    case 'TICK_TIMER':
      return { ...state, timer: Math.max(0, state.timer - 1) };
    case 'STOP_TIMER':
      return { ...state, isTimerRunning: false };
    default:
      return state;
  }
}

// --- COMPONENTS ---

const SetupScreen = ({ onStart }) => {
  const [teamCount, setTeamCount] = useState(2);
  const [teamNames, setTeamNames] = useState(['Team 1', 'Team 2']);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleTeamCountChange = (e) => {
    const count = parseInt(e.target.value);
    setTeamCount(count);
    const newNames = [...teamNames];
    while (newNames.length < count) newNames.push(`Team ${newNames.length + 1}`);
    setTeamNames(newNames.slice(0, count));
  };

  const handleNameChange = (index, val) => {
    const newNames = [...teamNames];
    newNames[index] = val;
    setTeamNames(newNames);
  };

  const handleFile = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  const startGame = async () => {
    setIsLoading(true);
    try {
      let categories = [];
      if (file) {
        const text = await file.text();
        categories = parseCSV(text);
      } else {
        // Default Mock Data
        categories = [
            {
              id: 1,
              title: "HISTORY 101",
              clues: [
                { id: 101, value: 200, question: "The first president of the United States.", answer: "Who is George Washington?" },
                { id: 102, value: 400, question: "The year the Titanic sank.", answer: "What is 1912?" },
                { id: 103, value: 600, question: "The empire that fell in 476 AD.", answer: "What is the Roman Empire?" },
                { id: 104, value: 800, question: "She was the last active ruler of the Ptolemaic Kingdom of Egypt.", answer: "Who is Cleopatra?" },
                { id: 105, value: 1000, question: "The war fought between the North and South in the US (1861-1865).", answer: "What is the Civil War?" },
              ]
            },
            {
              id: 2,
              title: "SCIENCE FICTION",
              clues: [
                { id: 201, value: 200, question: "The father of Luke Skywalker.", answer: "Who is Darth Vader?" },
                { id: 202, value: 400, question: "Author of 'Fahrenheit 451'.", answer: "Who is Ray Bradbury?" },
                { id: 203, value: 600, question: "The ship commanded by Captain Kirk.", answer: "What is the USS Enterprise?" },
                { id: 204, value: 800, question: "He wrote 'Do Androids Dream of Electric Sheep?'.", answer: "Who is Philip K. Dick?" },
                { id: 205, value: 1000, question: "The planet Paul Atreides calls home in 'Dune'.", answer: "What is Caladan?" },
              ]
            },
            {
              id: 3,
              title: "GEOGRAPHY",
              clues: [
                { id: 301, value: 200, question: "The largest continent by land area.", answer: "What is Asia?" },
                { id: 302, value: 400, question: "The capital of France.", answer: "What is Paris?" },
                { id: 303, value: 600, question: "The longest river in South America.", answer: "What is the Amazon River?" },
                { id: 304, value: 800, question: "Country known as the Land of the Rising Sun.", answer: "What is Japan?" },
                { id: 305, value: 1000, question: "The smallest country in the world.", answer: "What is Vatican City?" },
              ]
            },
            {
              id: 4,
              title: "TECH TALK",
              clues: [
                { id: 401, value: 200, question: "The company that makes the iPhone.", answer: "What is Apple?" },
                { id: 402, value: 400, question: "CEO of Tesla and SpaceX.", answer: "Who is Elon Musk?" },
                { id: 403, value: 600, question: "The programming language this app is built with.", answer: "What is JavaScript (or React)?" },
                { id: 404, value: 800, question: "The main database used by Wikipedia.", answer: "What is MariaDB/MySQL?" },
                { id: 405, value: 1000, question: "The year the World Wide Web was invented.", answer: "What is 1989?" },
              ]
            },
            {
              id: 5,
              title: "ANIMAL KINGDOM",
              clues: [
                { id: 501, value: 200, question: "The fastest land animal.", answer: "What is the Cheetah?" },
                { id: 502, value: 400, question: "The largest mammal in the world.", answer: "What is the Blue Whale?" },
                { id: 503, value: 600, question: "A group of lions is called this.", answer: "What is a Pride?" },
                { id: 504, value: 800, question: "The only mammal capable of true flight.", answer: "What is the Bat?" },
                { id: 505, value: 1000, question: "The number of hearts an octopus has.", answer: "What is Three?" },
              ]
            },
            {
              id: 6,
              title: "LITERATURE",
              clues: [
                { id: 601, value: 200, question: "He wrote 'Romeo and Juliet'.", answer: "Who is William Shakespeare?" },
                { id: 602, value: 400, question: "The wizarding school Harry Potter attends.", answer: "What is Hogwarts?" },
                { id: 603, value: 600, question: "Author of 'To Kill a Mockingbird'.", answer: "Who is Harper Lee?" },
                { id: 604, value: 800, question: "The Great Gatsby's first name.", answer: "Who is Jay?" },
                { id: 605, value: 1000, question: "The pen name of Samuel Clemens.", answer: "Who is Mark Twain?" },
              ]
            }
        ];
      }

      if (categories.length === 0) throw new Error("No valid categories found.");

      const teams = teamNames.map((name, i) => ({ id: i + 1, name, score: 0 }));
      onStart(teams, categories);
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-900 flex items-center justify-center gap-2">
            <Settings /> Game Setup
          </h1>
          <p className="text-gray-500 mt-2">Configure your JeoParty game</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload Questions (CSV)</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:bg-gray-50 transition-colors">
              <input type="file" accept=".csv" onChange={handleFile} className="hidden" id="csv-upload" />
              <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
                <Upload className="text-gray-400 mb-2" />
                <span className="text-sm text-blue-600 hover:underline">
                  {file ? file.name : "Click to upload CSV"}
                </span>
                <span className="text-xs text-gray-400 mt-1">Optional (Defaults available)</span>
              </label>
            </div>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Number of Teams</label>
            <select 
              value={teamCount} 
              onChange={handleTeamCountChange}
              className="w-full p-2 border border-gray-300 rounded-md"
            >
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} Teams</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Team Names</label>
            {teamNames.map((name, idx) => (
              <input 
                key={idx}
                type="text"
                value={name}
                onChange={(e) => handleNameChange(idx, e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                placeholder={`Team ${idx + 1} Name`}
              />
            ))}
          </div>

          <button 
            onClick={startGame}
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? "Loading..." : "Start Game"}
          </button>
        </div>
      </div>
    </div>
  );
};

const GameBoard = ({ categories, answeredClues, onClueClick, isHost }) => (
  <div className="grid grid-cols-6 gap-2 w-full max-w-7xl mx-auto h-full aspect-[4/3] md:aspect-auto p-2">
    {/* Headers */}
    {categories.map((cat) => (
      <div key={cat.id} className="bg-blue-900 border-2 border-black flex items-center justify-center p-2 text-center shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
        <h3 className="text-[10px] md:text-xs lg:text-base font-bold text-white uppercase drop-shadow-md break-words leading-tight">
          {cat.title}
        </h3>
      </div>
    ))}

    {/* Rows */}
    {[0, 1, 2, 3, 4].map((rowIndex) => (
      <React.Fragment key={`row-${rowIndex}`}>
        {categories.map((cat) => {
          const clue = cat.clues[rowIndex];
          const isAnswered = answeredClues.includes(clue.id);
          return (
            <button
              key={clue.id}
              disabled={isAnswered || !isHost}
              onClick={() => isHost && onClueClick(clue)}
              className={`
                relative aspect-[4/3] flex items-center justify-center border-2 border-black transition-all duration-300
                ${isAnswered 
                  ? 'bg-blue-950 cursor-default' 
                  : isHost 
                    ? 'bg-blue-800 hover:bg-blue-700 cursor-pointer shadow-[inset_0_0_15px_rgba(0,0,0,0.3)] hover:shadow-[inset_0_0_25px_rgba(250,204,21,0.2)]' 
                    : 'bg-blue-800 cursor-default' // Board view
                }
              `}
            >
              {!isAnswered && (
                <span className="text-yellow-400 font-bold text-xl md:text-3xl lg:text-4xl drop-shadow-md font-mono">
                  {clue.value}
                </span>
              )}
            </button>
          );
        })}
      </React.Fragment>
    ))}
  </div>
);

// --- MAIN APP COMPONENT ---

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const channelRef = useRef(null);
  const audioRef = useRef(new Audio(TIME_UP_SOUND));

  // --- 1. BROADCAST CHANNEL SETUP ---
  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    
    channelRef.current.onmessage = (event) => {
      if (event.data && event.data.type === 'SYNC_STATE') {
        // When a SYNC_STATE message is received, update the local state with the payload.
        // This is the mechanism that "starts the game" on the Board when launched.
        dispatch({ type: 'SYNC_STATE', payload: event.data.payload });
      }
    };

    // Check URL for role (e.g., ?role=board)
    const params = new URLSearchParams(window.location.search);
    if (params.get('role') === 'board') {
      dispatch({ type: 'SET_ROLE', payload: 'BOARD' });
    }

    return () => channelRef.current.close();
  }, []);

  // --- 2. SYNC HOST STATE TO BOARD (Real-time updates) ---
  useEffect(() => {
    // This effect ensures subsequent score, clue, and timer updates are broadcast.
    // It keeps the board updated after the initial sync.
    if (state.role === 'HOST' && state.categories.length > 0 && channelRef.current) { 
      // This is a throttled, continuous sync. The initial sync is now triggered by the button.
      const timeout = setTimeout(() => {
        channelRef.current.postMessage({
          type: 'SYNC_STATE',
          payload: {
            role: 'BOARD', // Force receiver to be board
            categories: state.categories,
            teams: state.teams,
            activeClue: state.activeClue,
            answeredClues: state.answeredClues,
            showAnswer: state.showAnswer,
            gameStarted: true,
            timer: state.timer,
            isTimerRunning: state.isTimerRunning
          }
        });
      }, 50); // Small debounce

      return () => clearTimeout(timeout);
    }
  }, [state.teams, state.activeClue, state.answeredClues, state.showAnswer, state.timer, state.isTimerRunning]); 

  // --- 3. TIMER LOGIC ---
  useEffect(() => {
    let interval;
    if (state.isTimerRunning && state.timer > 0) {
      interval = setInterval(() => {
        dispatch({ type: 'TICK_TIMER' });
      }, 1000);
    } else if (state.isTimerRunning && state.timer === 0) {
       // Timer hit zero
       audioRef.current.play().catch(e => console.log("Audio play failed", e));
       dispatch({ type: 'STOP_TIMER' });
    }
    return () => clearInterval(interval);
  }, [state.isTimerRunning, state.timer]);


  // --- HANDLERS ---
  
  const syncGameState = () => {
    // This function forces the complete state sync (including categories) to the Board channel.
    if (state.role === 'HOST' && state.categories.length > 0 && channelRef.current) {
      channelRef.current.postMessage({
        type: 'SYNC_STATE',
        payload: {
          role: 'BOARD',
          categories: state.categories,
          teams: state.teams,
          activeClue: state.activeClue,
          answeredClues: state.answeredClues,
          showAnswer: state.showAnswer,
          gameStarted: true,
          timer: state.timer,
          isTimerRunning: state.isTimerRunning
        }
      });
      console.log("Game state synchronized to board channel.");
    }
  };

  const launchBoard = () => {
    // This function ONLY opens the new window. The sync must be done first via the Start Game button.
    const width = 1280;
    const height = 720;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    window.open(
      `${window.location.pathname}?role=board`, 
      'JeoPartyBoard', 
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no`
    );
  };

  if (state.role === 'SETUP') {
    return <SetupScreen onStart={(teams, categories) => dispatch({ type: 'INIT_GAME', payload: { teams, categories } })} />;
  }

  // --- BOARD WAITING SCREEN ---
  // If the role is BOARD and categories are empty, it means the sync message hasn't arrived yet.
  if (state.role === 'BOARD' && state.categories.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-sans">
        <div className="text-center p-8 border-4 border-yellow-400 rounded-xl bg-blue-900/50 shadow-2xl">
          <Monitor size={48} className="text-yellow-400 mx-auto mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold">Waiting for Host Synchronization...</h2>
          <p className="mt-2 text-gray-300">The host must click **'Start Game (Sync)'** and then **'Launch Board'** to display the questions.</p>
        </div>
      </div>
    );
  }

  // --- RENDER: HOST & BOARD VIEWS ---

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col overflow-hidden font-sans">
      
      {/* HEADER */}
      <header className="bg-blue-900 border-b-4 border-black p-3 flex flex-wrap md:flex-nowrap justify-between items-center shadow-xl z-10 gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <HelpCircle className="text-yellow-400" size={28} />
          <h1 className="text-xl md:text-2xl font-extrabold tracking-widest text-yellow-400 drop-shadow-md">
            JEOPARTY! {state.role === 'HOST' ? '(HOST)' : ''}
          </h1>
        </div>
        
        {/* TEAM SCORES - IN HEADER */}
        <div className="flex-1 flex justify-center md:justify-end gap-4 overflow-x-auto">
          {state.teams.map(team => (
            <div key={team.id} className="bg-black/30 border border-yellow-500/30 rounded px-3 py-1 flex flex-col items-center min-w-[80px]">
              <div className="text-yellow-400 font-bold text-xs uppercase truncate w-full text-center max-w-[100px]">{team.name}</div>
              <div className={`text-lg font-mono font-bold leading-none ${team.score < 0 ? 'text-red-400' : 'text-white'}`}>
                {team.score}
              </div>
            </div>
          ))}
        </div>

        {state.role === 'HOST' && (
          <div className="flex gap-2 shrink-0">
            {/* NEW: Start Game Sync button */}
            <button 
              onClick={syncGameState}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-bold text-xs md:text-sm transition-colors"
              disabled={state.categories.length === 0}
            >
              <Check size={16} /> Start Game (Sync)
            </button>
            
            {/* Launch Board button (now only opens the window) */}
            <button 
              onClick={launchBoard}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded font-bold text-xs md:text-sm transition-colors"
            >
              <Monitor size={16} /> Launch Board
            </button>
          </div>
        )}
      </header>

      {/* MAIN AREA */}
      <main className="flex-1 overflow-auto flex flex-col relative">
        <GameBoard 
          categories={state.categories} 
          answeredClues={state.answeredClues} 
          onClueClick={(clue) => dispatch({ type: 'SELECT_CLUE', payload: clue })}
          isHost={state.role === 'HOST'}
        />

        {/* CLUE OVERLAY (SHARED VISUALS) */}
        {state.activeClue && (
          <div className="absolute inset-0 z-20 bg-blue-900 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
            
            {/* TIMER DISPLAY (VISIBLE TO ALL) */}
            <div className={`absolute top-8 right-8 flex items-center gap-2 text-4xl font-mono font-black ${state.timer === 0 ? 'text-red-500 animate-pulse' : 'text-yellow-400'}`}>
              <Clock size={40} />
              {state.timer}s
            </div>

            <div className="max-w-5xl flex-1 flex items-center justify-center flex-col gap-8">
              <h2 className="text-3xl md:text-5xl font-bold text-white uppercase leading-relaxed drop-shadow-lg shadow-black">
                {state.showAnswer ? state.activeClue.answer : state.activeClue.question}
              </h2>
            </div>
            
            {/* HOST CONTROLS */}
            {state.role === 'HOST' && (
              <div className="w-full bg-black/80 p-4 rounded-t-xl border-t-4 border-yellow-500 mt-auto backdrop-blur-md">
                 <div className="flex flex-col gap-4 items-center">
                   
                   {/* HOST PRIVATE ANSWER VIEW */}
                   <div className="bg-yellow-100 text-yellow-900 px-6 py-2 rounded-lg shadow-lg border-l-8 border-yellow-500 flex flex-col items-center min-w-[300px]">
                      <span className="text-[10px] font-black tracking-widest uppercase text-yellow-600 mb-1">Host Eyes Only</span>
                      <div className="text-lg font-bold text-center">
                        <span className="text-yellow-700 mr-2">ANSWER:</span>
                        {state.activeClue.answer}
                      </div>
                   </div>

                   {/* MAIN CONTROLS ROW */}
                   <div className="flex flex-wrap justify-center gap-4 w-full">
                      {/* 1. Timer Control */}
                      <button 
                        onClick={() => dispatch({ type: state.isTimerRunning ? 'STOP_TIMER' : 'START_TIMER' })}
                        className={`px-6 py-3 font-bold text-lg rounded shadow-lg flex items-center gap-2 ${state.isTimerRunning ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                      >
                        <Clock size={20} />
                        {state.isTimerRunning ? 'Stop Timer' : 'Start 5s Timer'}
                      </button>

                      {/* 2. Reveal/Close Control */}
                      {!state.showAnswer ? (
                        <button 
                          onClick={() => dispatch({ type: 'REVEAL_ANSWER' })}
                          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-blue-900 font-bold text-xl rounded shadow-lg transition-transform hover:scale-105"
                        >
                          Reveal to Players
                        </button>
                      ) : (
                        <button 
                          onClick={() => dispatch({ type: 'CLOSE_CLUE' })}
                          className="px-8 py-3 bg-gray-600 hover:bg-gray-500 text-white font-bold text-xl rounded shadow-lg transition-transform hover:scale-105"
                        >
                          Close Question
                        </button>
                      )}
                   </div>

                   {/* Team Scoring Controls */}
                   <div className="flex flex-wrap justify-center gap-4 w-full border-t border-gray-700 pt-4 mt-2">
                      {state.teams.map(team => (
                        <div key={team.id} className="flex flex-col items-center bg-slate-800 p-2 rounded-lg border border-slate-600 min-w-[100px]">
                          <span className="font-bold text-white mb-1 truncate max-w-[150px] text-sm">{team.name}</span>
                          <div className="flex gap-1">
                            <button 
                              onClick={() => dispatch({ type: 'UPDATE_SCORE', payload: { teamId: team.id, points: state.activeClue.value } })}
                              className="p-2 bg-green-600 hover:bg-green-500 rounded text-white transition-colors shadow-md"
                              title="Correct"
                            >
                              <Check size={16} />
                            </button>
                            <button 
                              onClick={() => dispatch({ type: 'UPDATE_SCORE', payload: { teamId: team.id, points: -state.activeClue.value } })}
                              className="p-2 bg-red-600 hover:bg-red-500 rounded text-white transition-colors shadow-md"
                              title="Incorrect"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                   </div>
                 </div>
              </div>
            )}
          </div>
        )}
      </main>

    </div>
  );
}
