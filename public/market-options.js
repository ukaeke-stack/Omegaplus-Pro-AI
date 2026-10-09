window.OMEGA_MARKET_OPTIONS={
  ou:{name:"Goals Over/Under",options:[
    {label:"Over 0.5",key:"over_0_5"},{label:"Over 1.5",key:"over_1_5"},{label:"Over 2.5",key:"over_2_5"},{label:"Over 3.5",key:"over_3_5"},{label:"Over 4.5",key:"over_4_5"},
    {label:"Under 0.5",key:"under_0_5"},{label:"Under 1.5",key:"under_1_5"},{label:"Under 2.5",key:"under_2_5"},{label:"Under 3.5",key:"under_3_5"},{label:"Under 4.5",key:"under_4_5"}]},
  "1x2":{name:"1X2",options:[{label:"Home",key:"home"},{label:"Draw",key:"draw"},{label:"Away",key:"away"}]},
  btts:{name:"BTTS",options:[{label:"Yes",key:"yes"},{label:"No",key:"no"}]},
  double_chance:{name:"Double Chance",options:[{label:"Home or Draw",key:"1x"},{label:"Home or Away",key:"12"},{label:"Draw or Away",key:"x2"}]},
  team_total:{name:"Team Goals Over/Under",options:[{label:"Home Over 0.5",key:"home_over_0_5"},{label:"Home Over 1.5",key:"home_over_1_5"},{label:"Home Over 2.5",key:"home_over_2_5"},{label:"Away Over 0.5",key:"away_over_0_5"},{label:"Away Over 1.5",key:"away_over_1_5"},{label:"Away Over 2.5",key:"away_over_2_5"}]},
  handicap:{name:"Handicap",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]},
  corners:{name:"Corners Over/Under",options:[
    {label:"Over 7.5",key:"over_7_5"},{label:"Over 8.5",key:"over_8_5"},{label:"Over 9.5",key:"over_9_5"},{label:"Over 10.5",key:"over_10_5"},{label:"Over 11.5",key:"over_11_5"},
    {label:"Under 7.5",key:"under_7_5"},{label:"Under 8.5",key:"under_8_5"},{label:"Under 9.5",key:"under_9_5"},{label:"Under 10.5",key:"under_10_5"},{label:"Under 11.5",key:"under_11_5"}]},
  cards:{name:"Cards/Bookings Over/Under",options:[
    {label:"Over 1.5",key:"over_1_5"},{label:"Over 2.5",key:"over_2_5"},{label:"Over 3.5",key:"over_3_5"},{label:"Over 4.5",key:"over_4_5"},{label:"Over 5.5",key:"over_5_5"},
    {label:"Under 1.5",key:"under_1_5"},{label:"Under 2.5",key:"under_2_5"},{label:"Under 3.5",key:"under_3_5"},{label:"Under 4.5",key:"under_4_5"},{label:"Under 5.5",key:"under_5_5"}]}
};

window.OMEGA_SPORT_MARKETS={football:["ou","1x2","btts","double_chance","team_total","handicap","corners","cards"],basketball:["basketball_total","basketball_handicap","basketball_moneyline"]};
window.OMEGA_MARKET_OPTIONS.basketball_total={name:"Points Over/Under",options:[{label:"Over 150.5",key:"over_150_5"},{label:"Over 160.5",key:"over_160_5"},{label:"Over 170.5",key:"over_170_5"},{label:"Under 150.5",key:"under_150_5"},{label:"Under 160.5",key:"under_160_5"},{label:"Under 170.5",key:"under_170_5"}]};
window.OMEGA_MARKET_OPTIONS.basketball_handicap={name:"Basketball Handicap / Spread",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.basketball_moneyline={name:"Basketball Winner",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};

window.OMEGA_MARKET_OPTIONS.basketball_team_total={name:"Team Total Points",options:[{label:"Over 70.5",key:"over_70_5"},{label:"Over 80.5",key:"over_80_5"},{label:"Over 90.5",key:"over_90_5"},{label:"Under 70.5",key:"under_70_5"},{label:"Under 80.5",key:"under_80_5"},{label:"Under 90.5",key:"under_90_5"}]};
window.OMEGA_SPORT_MARKETS.basketball.push("basketball_team_total");

window.OMEGA_MARKET_OPTIONS.first_half_ou={name:"First-Half Goals",options:[{label:"1H Over 0.5",key:"1h_over_0_5"},{label:"1H Over 1.5",key:"1h_over_1_5"},{label:"1H Over 2.5",key:"1h_over_2_5"},{label:"1H Under 0.5",key:"1h_under_0_5"},{label:"1H Under 1.5",key:"1h_under_1_5"},{label:"1H Under 2.5",key:"1h_under_2_5"}]};
window.OMEGA_MARKET_OPTIONS.half_time_result={name:"Half-Time Result",options:[{label:"HT Home",key:"ht_home"},{label:"HT Draw",key:"ht_draw"},{label:"HT Away",key:"ht_away"}]};
window.OMEGA_MARKET_OPTIONS.btts_goals={name:"BTTS + Goals",options:[{label:"BTTS + Over 1.5",key:"btts_over_1_5"},{label:"BTTS + Over 2.5",key:"btts_over_2_5"},{label:"BTTS + Over 3.5",key:"btts_over_3_5"},{label:"BTTS + Under 4.5",key:"btts_under_4_5"}]};
window.OMEGA_MARKET_OPTIONS.team_corners={name:"Team Corners",options:[{label:"Home Over 2.5",key:"home_corners_2_5"},{label:"Home Over 3.5",key:"home_corners_3_5"},{label:"Away Over 2.5",key:"away_corners_2_5"},{label:"Away Over 3.5",key:"away_corners_3_5"}]};
window.OMEGA_MARKET_OPTIONS.team_cards={name:"Team Cards",options:[{label:"Home Over 0.5",key:"home_cards_0_5"},{label:"Home Over 1.5",key:"home_cards_1_5"},{label:"Away Over 0.5",key:"away_cards_0_5"},{label:"Away Over 1.5",key:"away_cards_1_5"}]};
window.OMEGA_SPORT_MARKETS.football.push("first_half_ou","half_time_result","btts_goals","team_corners","team_cards");

window.OMEGA_MARKET_OPTIONS.basketball_first_half_total={name:"1st Half Points",options:[{label:"1H Over 70.5",key:"1h_over_70_5"},{label:"1H Over 80.5",key:"1h_over_80_5"},{label:"1H Over 90.5",key:"1h_over_90_5"},{label:"1H Under 70.5",key:"1h_under_70_5"},{label:"1H Under 80.5",key:"1h_under_80_5"},{label:"1H Under 90.5",key:"1h_under_90_5"}]};
window.OMEGA_MARKET_OPTIONS.basketball_first_half_moneyline={name:"1st Half Winner",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.basketball_quarter_total={name:"Quarter Points",options:[{label:"Q1 Over 40.5",key:"q1_over_40_5"},{label:"Q1 Over 50.5",key:"q1_over_50_5"},{label:"Q2 Over 40.5",key:"q2_over_40_5"},{label:"Q3 Over 40.5",key:"q3_over_40_5"},{label:"Q4 Over 40.5",key:"q4_over_40_5"}]};
window.OMEGA_SPORT_MARKETS.basketball.push("basketball_first_half_total","basketball_first_half_moneyline","basketball_quarter_total");

window.OMEGA_MARKET_OPTIONS.tennis_moneyline={name:"Tennis Match Winner",options:[{label:"Player 1",key:"home"},{label:"Player 2",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.tennis_total_games={name:"Tennis Total Games",options:[{label:"Over 20.5",key:"over_20_5"},{label:"Over 22.5",key:"over_22_5"},{label:"Over 24.5",key:"over_24_5"},{label:"Under 20.5",key:"under_20_5"},{label:"Under 22.5",key:"under_22_5"},{label:"Under 24.5",key:"under_24_5"}]};
window.OMEGA_MARKET_OPTIONS.tennis_handicap={name:"Tennis Games Handicap",options:[{label:"Player 1",key:"home"},{label:"Player 2",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.tennis_set_betting={name:"Tennis Set Betting",options:[{label:"2-0",key:"2_0"},{label:"2-1",key:"2_1"},{label:"0-2",key:"0_2"},{label:"1-2",key:"1_2"}]};

window.OMEGA_MARKET_OPTIONS.hockey_moneyline={name:"Ice Hockey Match Winner",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.hockey_total_goals={name:"Ice Hockey Goals Over/Under",options:[{label:"Over 4.5",key:"over_4_5"},{label:"Over 5.5",key:"over_5_5"},{label:"Over 6.5",key:"over_6_5"},{label:"Under 4.5",key:"under_4_5"},{label:"Under 5.5",key:"under_5_5"},{label:"Under 6.5",key:"under_6_5"}]};
window.OMEGA_MARKET_OPTIONS.hockey_puck_line={name:"Ice Hockey Puck Line",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.hockey_period={name:"Ice Hockey Period Markets",options:[{label:"1st Period Home",key:"home"},{label:"1st Period Draw",key:"draw"},{label:"1st Period Away",key:"away"}]};

window.OMEGA_MARKET_OPTIONS.baseball_moneyline={name:"Baseball Match Winner",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.baseball_total_runs={name:"Baseball Total Runs",options:[{label:"Over 7.5",key:"over_7_5"},{label:"Over 8.5",key:"over_8_5"},{label:"Over 9.5",key:"over_9_5"},{label:"Under 7.5",key:"under_7_5"},{label:"Under 8.5",key:"under_8_5"},{label:"Under 9.5",key:"under_9_5"}]};
window.OMEGA_MARKET_OPTIONS.baseball_run_line={name:"Baseball Run Line",options:[{label:"Home",key:"home"},{label:"Away",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.baseball_innings={name:"Baseball Innings Markets",options:[{label:"1st Inning Over 0.5",key:"over_0_5"},{label:"1st Inning Under 0.5",key:"under_0_5"}]};

window.OMEGA_MARKET_OPTIONS.table_tennis_moneyline={name:"Table Tennis Match Winner",options:[{label:"Player 1",key:"home"},{label:"Player 2",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.table_tennis_total_points={name:"Table Tennis Total Points",options:[{label:"Over 70.5–75.5",key:"over_range_70_5_75_5"},{label:"Over 76.5–80.5",key:"over_range_76_5_80_5"},{label:"Over 81.5–85.5",key:"over_range_81_5_85_5"},{label:"Under 70.5–75.5",key:"under_range_70_5_75_5"},{label:"Under 76.5–80.5",key:"under_range_76_5_80_5"},{label:"Under 81.5–85.5",key:"under_range_81_5_85_5"}]};
window.OMEGA_MARKET_OPTIONS.table_tennis_handicap={name:"Table Tennis Points Handicap",options:[{label:"Player 1",key:"home"},{label:"Player 2",key:"away"}]};
window.OMEGA_MARKET_OPTIONS.table_tennis_set_betting={name:"Table Tennis Correct Set Score",options:[{label:"3-0",key:"3_0"},{label:"3-1",key:"3_1"},{label:"3-2",key:"3_2"},{label:"0-3",key:"0_3"},{label:"1-3",key:"1_3"},{label:"2-3",key:"2_3"}]};
window.OMEGA_SPORT_MARKETS.table_tennis=["table_tennis_moneyline","table_tennis_total_points","table_tennis_handicap","table_tennis_set_betting"];
window.OMEGA_SPORT_MARKETS.tennis=["tennis_moneyline","tennis_total_games","tennis_handicap","tennis_set_betting"];
window.OMEGA_SPORT_MARKETS.ice_hockey=["hockey_moneyline","hockey_total_goals","hockey_puck_line","hockey_period"];
window.OMEGA_SPORT_MARKETS.baseball=["baseball_moneyline","baseball_total_runs","baseball_run_line","baseball_innings"];
