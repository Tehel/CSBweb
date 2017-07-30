'use strict';

class Dungeon {
	constructor() {
	}

	async init() {
		await this.readLevels();
	}

	async readLevels() {
		this.dungeonFile = new RemoteBinaryFile();
		await this.dungeonFile.get('gamefiles/dungeon.dat');

		this.seed = this.dungeonFile.read16();
		this.totalMapsSize = this.dungeonFile.read16();
		this.mapNumber = this.dungeonFile.read();
		this.dungeonFile.read();
		this.textListSize = this.dungeonFile.read16() * 2;
		let tmp = this.dungeonFile.read16();
		this.startPos = {
			level: 0,
			x: (tmp & 0x3e0) >> 5,
			y: tmp & 0x1f,
			direction: ['North', 'East', 'South', 'West'][(tmp & 0xc00)>>10],
		};
		this.objectListSize = this.dungeonFile.read16() * 2;
		this.objectNb = {
			doors: this.dungeonFile.read16(),
			teleporters: this.dungeonFile.read16(),
			texts: this.dungeonFile.read16(),
			actuators: this.dungeonFile.read16(),
			creatures: this.dungeonFile.read16(),
			weapons: this.dungeonFile.read16(),
			cloths: this.dungeonFile.read16(),
			scrolls: this.dungeonFile.read16(),
			potions: this.dungeonFile.read16(),
			containers: this.dungeonFile.read16(),
			miscellaneous: this.dungeonFile.read16(),
			dummy1: this.dungeonFile.read16(),
			dummy2: this.dungeonFile.read16(),
			dummy3: this.dungeonFile.read16(),
			missiles: this.dungeonFile.read16(),
			clouds: this.dungeonFile.read16(),
		};
		this.maps = [];
		for (let i=0; i<this.mapNumber; i++) {
			let newlevel = {};
			newlevel.dataOffset = this.dungeonFile.read16();
			this.dungeonFile.skip(4);
			newlevel.offsetX = this.dungeonFile.read();
			newlevel.offsetY = this.dungeonFile.read();
			tmp = this.dungeonFile.read16();
			newlevel.height = (tmp & 0xf800) >> 11;
			newlevel.width = (tmp & 0x7c0) >> 6;
			newlevel.floor = tmp & 0x3f;
			tmp = this.dungeonFile.read16();
			newlevel.nbFloorDecoration = (tmp & 0xf000) > 12; 
			newlevel.nbFloor = (tmp & 0xf00) > 8; 
			newlevel.nbWallDecoration = (tmp & 0xf0) > 4; 
			newlevel.nbWall = tmp & 0xf; 

			this.maps.push(newlevel);
		}
	}
}

/*
RESTARTABLE _ReadEntireGame(void)
{//i16
  static dReg D0, D1, D5, D6, D7;
  static dReg saveD0;
  static aReg A3;
  i32 numLevel;
  RESTARTMAP
    //RESTART(1)
    RESTART(2)
    RESTART(3)
    RESTART(4)
    RESTART(5)
    RESTART(6)
    RESTART(7)
    //RESTART(8)
    RESTART(9)
    //RESTART(10)
    //RESTART(11)
    RESTART(12)
    RESTART(13)
    RESTART(14)
    RESTART(15)
    RESTART(16)
  END_RESTARTMAP
//;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
  ASSERT( sizeof(b) == 740 ,"b");
  indirectText = false;
  extendedPortraits = false; // 20150806
  memset(&b, 0, sizeof(b));
  D6L = 0;
  //SaveRegs(0x0710);
  D5W = 0;
  d.Word22596 = 2;
  d.Word22598 = 1;
  d.Word22594 = 1;
  d.Word22592 = 13;
  A3 = NULL;
  currentOverlay.Cleanup();
  if (d.gameState == GAMESTATE_ResumeSavedGame)
    goto tag01ebbe;

  D0W = InsertDisk(0,1);
  //D0W = i16Result;
  if (D0W == 0) D0W =1; else D0W = 0;
  D5W = D0W;
  d.datafileHandle = OPEN(dungeonName,"rb");
  if (d.datafileHandle < 0)  {
    char  *msg;
    msg = (char *)UI_malloc(strlen(dungeonName) + 100, MALLOC030);
    sprintf(msg, "Cannot open dungeon file '%s'", dungeonName);
    die(50, msg);
    UI_free(msg);
  };
tag01eb82:
  Signature(d.datafileHandle, &dungeonSignature1, &dungeonSignature2);
  if (encipheredDataFile != NULL)
  {
    SETENCIPHERED(d.datafileHandle, encipheredDataFile, 64);
  };
  d.CanRestartFromSavegame = 0;
  d.NumCharacter = 0;
  ASSERT(RememberToPutObjectInHand == -1,"objInHand");

  {
    CURSORFILTER_PACKET cfp;
    cfp.type = CURSORFILTER_ReadGame;
    cfp.object = RN(RNnul).ConvertToInteger();
    CursorFilter(&cfp);
  };
  d.objectInHand = RN(RNnul);

  if (IsPlayFileOpen()) {
    MouseQueueEnt MQ;
    PlayFile_Play(&MQ);
    if (MQ.num != 0x3333) {
      i32 ans;
      ans = UI_MessageBox("Replay Starting Random Error","Error",MESSAGE_YESNO);
      if (ans == MESSAGE_IDYES) die(0x7bbd);
    }
    // d.RandomNumber was set in PlayFile.Play.
  } else {
    MouseQueueEnt MQ;
    MQ.num = 0x3333;
    MQ.x = (ui16)((d.RandomNumber >> 16) & 0xffff);
    MQ.y = (ui16)(d.RandomNumber & 0xffff);
    RecordFile_Record(&MQ);
  }
  D0L = STRandom();
  D0L &= 0xffff;
  //SaveRegs(0x8000); // D0
  saveD0 = D0;
  D1L = STRandom();
  //RestoreRegs(0x0001);// D0
  D0 = saveD0;
  /////////
  D0L = D0UW * D1UW;
  //////////
  d.RandomGameID = D0L;
  goto tag01eec4;

tag01ebbe:
  A3 = NULL;
  SubstDiskLetter((char *)b.Byte50, "PUT THE GAME SAVE DISK IN ~", 2);
  SubstDiskLetter((char *)b.Byte100, "THERE IS NO DISK IN ~!", 2);
tag01ebec:
  if (!d.SingleFloppyDrive) goto tag01ec08;

  D0W = 1;
  if (D0W != 1) goto tag01ec12;
tag01ec08:
  if (A3 == NULL) 
    goto tag01ec6a;

tag01ec12:
  DoMenu(_12_, A3, b.Byte50, "LOAD SAVED GAME", "CANCEL", NULL, NULL, 1, 1, 1);
  STShowCursor(HC33);
  WaitForMenuSelect(_7_, 2,1,2,1);
  STHideCursor(HC33);
  ExtendedFeaturesSize = 0;
  D7W = D0W = i16Result;
  if (D7W != 2) goto tag01ec6a;
tag01ec56:
  InsertDisk(0, 1);
  D0W = -1;
  RETURN_i16(D0W);
tag01ec6a:
  D0L = 1;
  STShowCursor(HC33);
  SelectSaveGame(_9_, 1, 1, 1); //TAG0204bc
  STHideCursor(HC33);
  d.Word22972 = 1;
  D6W = 0;
  D0W = OPEN(d.SaveGameFilename,"rb");
  d.datafileHandle = D0W;
  if (D0W >= 0) goto tag01ece8;
  OPEN(d.Pointer22980, "rb");
  d.datafileHandle = D0W;
  if (D0W < 0) goto tag01ecb2;
  D6W = 1;
  goto tag01ece8;
tag01ecb2:
  D0W = d.PartyHasDied;
  if (D0W != 0) goto tag01ecde;
  D0W = OPEN("DUNGEON.FTL","rb");
  d.datafileHandle = D0W;
  if (D0W < 0) goto tag01ecde;
  D5W = 1;
  d.gameState = GAMESTATE_EnterPrison;
  goto tag01eb82;
tag01ecde:
  A3 = (aReg)"CAN'T FIND SAVED GAME!";
  d.Word22972 = 3;
tag01ece8:
  Signature(d.datafileHandle, &dungeonSignature1, &dungeonSignature2);
  RecordFile_Record((dungeonSignature1 >> 16) & 0xffff,
                     dungeonSignature1 & 0xffff,
                     0x6669);
  if (encipheredDataFile)
  {
    SETENCIPHERED(d.datafileHandle, encipheredDataFile, 64);
  };
  if (d.Word22972 != 1) goto tag01ec12;
  // Read the first 512 bytes from the game file and
  // unscramble it.
  ExtendedFeaturesSize = ReadExtendedFeatures(d.datafileHandle);
  D0W = ReadUnscrambleBlock((ui8 *)&b.gb1);//TAG01db46
  if (D0W == 0) goto tag01efee; //If error
  swapBlock1(&b.gb1); // Swap words/longs as necessary in block 1
  totalMoveCount = b.gb1.totalMoveCount;
  if (d.PartyHasDied == 0) goto tag01ed54;
  if (b.gb1.RandomGameID == d.RandomGameID) goto tag01ed54;
  A3 = (aReg)"THAT'S NOT THE SAME GAME";
  goto tag01ebec;

tag01ed54:
  d.RandomGameID = b.gb1.RandomGameID;
  MemMove((ui8 *)b.gb1.Byte22808, (ui8 *)d.Byte22808, 132);//All zeroes in my CSBGAME2.DAT
  D0W = b.gb1.Byte22596;
  if (D0W == 1) goto tag01ed86;
  // Removed this to be able to read Atari DM saved game.  if (b.gb1.Word22594 != 1) goto tag01efee;
tag01ed86:
  // Read second block of data from game file
  D0W = UnscrambleStream((ui8 *)&b.gb2,          // buffer
                          128,                  // #bytes
                          b.gb1.Block2Hash,     // initial hash
                          b.gb1.Block2Checksum);// expected checksum
  if (D0W == 0) goto tag01efee;
  swapBlock2(&b.gb2); // fix byte order
  scrollingText.ResetTime(b.gb2.Time);
  d.Time = d.Long11732 = b.gb2.Time;
  parameterMessageSequence = 0;
  d.RandomNumber = b.gb2.ranseed;
  if (TimerTraceActive)
  {
    fprintf(GETFILE(TraceFile),"Setting d.RandomNumber from savefile = %08x\n",d.RandomNumber);
  };
  d.NumCharacter = b.gb2.numcharacter;
  d.partyX = b.gb2.partyx;
  d.partyY = b.gb2.partyy;
  d.partyFacing = b.gb2.partyfacing;
  d.partyLevel = b.gb2.partyLevel;
  d.HandChar = b.gb2.handChar; // chIdx
  d.MagicCaster = b.gb2.MagicCaster;
  gameTimers.Allocate(b.gb2.MaxTimers);
  gameTimers.NumTimer(b.gb2.NumTimer);
  gameTimers.FirstAvailTimer(b.gb2.FirstAvailTimer);
  gameTimers.TimerSequence(b.gb2.TimerSequence);
  d.ITEM16QueLen = b.gb2.ITEM16QueLen;
  d.LastMonsterAttackTime = b.gb2.LastMonsterAttackTime;
  d.LastPartyMoveTime = b.gb2.LastPartyMoveTime;
  d.partyMoveDisableTimer = b.gb2.partyMoveDisableTimer;
  d.Word11712 = b.gb2.Word11712;
  d.Word11714 = b.gb2.Word11714;

  d.objectInHand.NonExtendedInteger(b.gb2.ObjectInHand);
  {
    CURSORFILTER_PACKET cfp;
    cfp.object = d.objectInHand.ConvertToInteger();
    cfp.type = CURSORFILTER_ReadGame;
    CursorFilter(&cfp);
  };

  //RememberToPutObjectInHand = b.gb2.ObjectInHand;
  d.MaxITEM16 = b.gb2.MaxITEM16;
  do
  {
    HandleMouseEvents(_16_,-999887);//initialize
  } while (intResult & 1);
  D0W = d.PartyHasDied;
  if (D0W == 0) {
    gameTimers.InitializeTimers();
    InitializeItem16();
  }
  if (d.MaxITEM16 != 0) {
    D0W = UnscrambleStream((ui8 *)d.Item16,     // buffer
                            16 * d.MaxITEM16,  // #bytes
                            b.gb1.ITEM16Hash,
                            b.gb1.ITEM16Checksum);
    if (D0W == 0) goto tag01efee;
    swapITEM16s();
  }
  D0W = UnscrambleStream((ui8 *)d.CH16482, // buffer
                         3328,        // # bytes
                         b.gb1.CharacterHash,
                         b.gb1.CharacterChecksum);
  if (D0W == 0) goto tag01efee;
  swapCharacterData();
  {
    int timerSize;
    //timerSize = sequencedTimers?sizeof(TIMER):10;
    timerSize = sequencedTimers ? 12 : 10;
    timerSize = extendedTimers ? 16 : timerSize;
    D0W = UnscrambleStream((ui8 *)gameTimers.pTimer(0),  // buffer
                          (ui16)gameTimers.MaxTimer() * timerSize,// # bytes
                          b.gb1.TimersHash,      // initial hash
                          b.gb1.TimersChecksum); // expected checksum
  };
  if (D0W == 0) goto tag01efee;
  D0W = UnscrambleStream((ui8 *)gameTimers.TimerQueue(),// buffer
                         (ui16)gameTimers.MaxTimer()*2,    // #bytes
                         b.gb1.TimerQueHash,     // initial hash
                         b.gb1.TimerQueChecksum);// expected checksum
  if (D0W == 0) goto tag01efee;

  gameTimers.swapTimerQue();

  if (!sequencedTimers) {
    if (GETFILE(TraceFile) != NULL) {
      for (int i=0; i<gameTimers.m_numTimer; i++) {
        char *pTimer = (char *)gameTimers.m_timers + 10*gameTimers.m_timerQueue[i];
        fprintf(GETFILE(TraceFile), "%04x   ", gameTimers.m_timerQueue[i]);
        for (int j=0; j<sizeof(TIMER); j++)
          fprintf(GETFILE(TraceFile), "%02x ", *(pTimer + j)&0xff);
        fprintf(GETFILE(TraceFile),"\n");
      }
    }
    gameTimers.ConvertToSequencedTimers();
  }
  if (GETFILE(TraceFile) != NULL) {
    for (int i=0; i<gameTimers.m_numTimer; i++) {
      TIMER *pTimer = gameTimers.m_timers + gameTimers.m_timerQueue[i];
      fprintf(GETFILE(TraceFile), "%04x   ", gameTimers.m_timerQueue[i]);
      for (int j=0; j<sizeof(TIMER); j++)
        fprintf(GETFILE(TraceFile), "%02x ", (*((char *)pTimer + j))&0xff);
      fprintf(GETFILE(TraceFile),"\n");
    }
  }

  if (!extendedTimers)
    gameTimers.ConvertToExtendedTimers();
  
  swapTimers();

  if (GETFILE(TraceFile) != NULL) {
    for (int i=0; i<gameTimers.m_numTimer; i++) {
      TIMER *pTimer = gameTimers.m_timers + gameTimers.m_timerQueue[i];
      fprintf(GETFILE(TraceFile), "%04x   ", gameTimers.m_timerQueue[i]);
      for (int j=0; j<sizeof(TIMER); j++)
        fprintf(GETFILE(TraceFile), "%02x ", (*((char *)pTimer + j))&0xff);
      fprintf(GETFILE(TraceFile),"\n");
    }
  }



tag01eec4:
  D0W = ReadDatabases();
  if (D0W == 0) goto tag01efee;
  {
    i32 i, size;
    ui32 *pRecord;
    //Remove all current Global Variables.
    if (globalVariables != NULL) UI_free(globalVariables);
    numGlobalVariables = 0;
    globalVariables = NULL;
    //Read all Global variables.
    for (i=0; i<999; i++)
    {
      size = expool.Locate((EDT_Database<<24)|(EDBT_GlobalVariables<<16)|i, &pRecord);
      if (size <16) break;
      numGlobalVariables += 16;
      globalVariables = (ui32 *)UI_realloc(globalVariables, 16*(i+1)*sizeof(ui32), MALLOC105);
      memcpy (&globalVariables[16*i], pRecord, 16*sizeof(ui32));
    };
    // Now we will see if a record of DSA tracing flags exists.
    DSAIndex.ReadTracing();
  };
  {
    // Read the palette in effect at time of save.
    int i;
    ui32 *pRecord = NULL;
    ui8 palette[3*512];
    for (i=0; i<24; i++)
    {
      ui32 key;
      int size;
      key = (EDT_Palette<<24) + i;
      size = expool.Locate(key, &pRecord);
      if (size >=16)
      {
        memcpy(palette+64*i, pRecord, 64);
      }
      else
      {
        pRecord = NULL;
        break;
      };
    };
    if (pRecord != NULL)
    {
      memcpy(overlayPaletteRed, palette+0, 512);
      memcpy(overlayPaletteGreen, palette+512, 512);
      memcpy(overlayPaletteBlue, palette+1024, 512);
    };
  };
  ui32 junk[32];
  disableSaves = false;
  while (expool.Read((EDT_Database<<24)|(EDBT_DisableSaves<<16),junk,32) >= 0)
    disableSaves = true;

  ui32 *pRec;
  EDBT_Debuging_data = 0;
  EDBT_CSBGraphicsSignature_data = 0;
  EDBT_GraphicsSignature_data = 0;
  EDBT_CSBversion_data = 0;

  if (expool.Locate( (EDT_Database<<24) + (EDBT_DeleteDuplicateTimers<<16),&pRec) < 0)
    deleteDuplicateTimers = 1; // The old way
  else
    deleteDuplicateTimers = *pRec;

  if (expool.Locate( (EDT_Database<<24) + ((EDBT_Debuging<<16) + 0),&pRec) > 0)
    EDBT_Debuging_data = *pRec;

  if (EDBT_Debuging_data == 0) {
    ui32 *pRec;
    if (expool.Locate((EDT_Database<<24) + (EDBT_RuntimeFileSignatures<<16) + 0, &pRec) > 0)
      EDBT_CSBGraphicsSignature_data = *pRec;

    if (expool.Locate((EDT_Database<<24) + (EDBT_RuntimeFileSignatures<<16) + 2, &pRec) > 0)
      EDBT_CSBversion_data = *pRec;

    if (expool.Locate((EDT_Database<<24) + (EDBT_RuntimeFileSignatures<<16) + 1, &pRec) > 0)
      EDBT_GraphicsSignature_data = *pRec;
  }

  openGraphicsFile(); // Force a graphics.dat signature check
  closeGraphicsFile();

  if (D0W == 0) goto tag01efee;
  CheckCelltypes();
  CheckMonsters();
  ExtendPortraits();
  if (D0W == 0) {
    CLOSE (d.datafileHandle);
    goto tag01efee;
  };
#ifdef _DEBUG
  //An early version made the character load weight wrong.
  //We will fix them up as we read the saved games.
  recomputeLoads();
#endif
  numLevel = d.dungeonDatIndex->NumLevel();
  if (numLevel > 2)
  {
    ItemsRemainingOK = true; //Enable Menu "view" "items remaining"
  };
  CLOSE(d.datafileHandle);
  if (d.gameState == GAMESTATE_ResumeSavedGame) goto tag01ef2c;
  gameTimers.InitializeTimers();
  InitializeItem16();
  do
  {
    HandleMouseEvents(_15_, -999887); //Cue to initialize
  } while (intResult & 1);
  if (D5W == 0) goto tag01ef1c;
  FadeToPalette(_5_,&d.Palette11914);
  wvbl(_2_);
  ClearMemory(d.LogicalScreenBase, 32000);
  FadeToPalette(_3_,&d.Palette11978);
tag01ef1c:
  InsertDisk(0,1);
  goto tag01efe4;
tag01ef2c:
  D0W = (UI8)(b.gb1.Byte22598);
  d.Word22598 = D0W;
  D0W = (UI8)(b.gb1.Byte22596);
  if (D0W != 1) goto tag01ef82;
  D7W = (I16)d.dungeonDatIndex->NumLevel();
  if (D7W != 14) goto tag01ef64;
  if (d.dungeonDatIndex->Sentinel() != 99) goto tag01ef64;
  d.Word22592 = 10;
  goto tag01ef80;
tag01ef64:
  if (D7W != 10) goto tag01ef7c;
  if (d.dungeonDatIndex->Sentinel() != 76) goto tag01ef7c;
  d.Word22592 = 13;
  goto tag01ef80;
tag01ef7c:
  d.Word22592 = 0;
tag01ef80:
  goto tag01ef98;
tag01ef82:
  D0W = b.gb1.Byte22596;
  d.Word22596 = D0W;
  d.Word22594 = b.gb1.Word22594;
  d.Word22592 = b.gb1.Word22592;
tag01ef98:
  d.CanRestartFromSavegame = 1;
  D0W = D6W;
  if (D0W == 0) goto tag01efb8;
  RENAME(0,d.Pointer22980,d.SaveGameFilename);
tag01efb8:
  InsertDisk(1,1);
  DoMenu(_13_,NULL, "LOADING GAME . . .", NULL,NULL,NULL,NULL,1,1,1);
tag01efe4:
  d.GameIsLost = 0;
  D0W = 1;
  RETURN_i16(D0W);

tag01efee:
  FadeToPalette(_4_,&d.Palette11978);
  D0W = d.PartyHasDied;
  if (D0W == 0) goto BadSavedGame;
  DoMenu(_14_, "SAVED GAME DAMAGED!", "PUT THE CHAOS STRIKES BACK DISK IN ~", "OK", NULL, NULL, NULL, 1, 1, 1);
  STShowCursor(HC33);
  WaitForMenuSelect(_6_, 1,1,0,0);
  STHideCursor(HC33);
  goto tag01ec56;

BadSavedGame:
  PRINTLINE("SAVED GAME DAMAGED!");
  die (0xbad);
//tag01f046:
  //RestoreRegs(0x08e0);
  RETURN_i16(D0W);
}

// *********************************************************
//
// *********************************************************
//  TAG01e552
i16 ReadDatabases(void)
{
//;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
  dReg D0, D1, D3, D4, D5, D6;
  aReg A0, A3;
  i32 numLevel;
  i32 memSizeError;
  i32 celloffset=0;
  LEVELDESC *pA0;
//  i16 *pwA3;
  DBCOMMON *DBA3;
  CELLFLAG *pdD0;
  CELLFLAG **ppdA2;
//  i16 LOCAL_30;
  i8  LOCAL_20[8];
  i32 filesize; // LOCAL_12
  i16 CheckSum;
  i16 LOCAL_6;
  CELLFLAG *LOCAL_4;
  SAFEMEM textArray;
  CheckSum = 0;
  d.inStreamBuffered = 0; // Read from file
  if (d.gameState != GAMESTATE_ResumeSavedGame)
  {
    ExtendedFeaturesSize = ReadExtendedFeatures(d.datafileHandle);
    D0L = READ(d.datafileHandle,8,(ui8 *)LOCAL_20);
    if (D0L != 8) return 0;
    if ((ui16)LE16(wordGear(LOCAL_20))!=33028)
    {
      LSEEK(ExtendedFeaturesSize,d.datafileHandle,SEEK_SET); // Rewind
      D0L = D0L>=0?1:0; // Set if succes
    }
    else
    {
      d.Word22592 = LE16(wordGear(LOCAL_20+6));
      d.inStreamBuffered = 1; // Read from memory buffer
      d.inStreamLeft = LE32(LoadLong(LOCAL_20+2));
      d.inStreamNext = (pnt)allocateMemory(d.inStreamLeft,2);
      D0L = LSEEK(0, d.datafileHandle, SEEK_END); // To eof
      D0L -= 8; // File size -8
      if (ExtendedFeaturesVersion != '@') D0L -= ExtendedFeaturesSize;
      filesize = D0L;
      A3 = (aReg)allocateMemory(filesize, 2);
      D0L = LSEEK(8+(ExtendedFeaturesVersion=='@'?0:ExtendedFeaturesSize),
                  d.datafileHandle,
                  SEEK_SET); // To byte 8/of file.
      D0L = READ(d.datafileHandle, filesize, (ui8 *)A3); // Read entire file
      if (D0L != filesize) return 0;
      ExpandData(A3, d.inStreamNext, LE32(LoadLong(LOCAL_20+2)));
      TAG021800(filesize); //Release file buffer memory
    };
  };
  if (IsRecordFileRecording())
  {
    if (   
#ifndef _DEBUG  // Record Design option is default for _DEBUG builds
           RecordDesignOption  &&
#endif
              !NoRecordCommandOption 
           && !NoRecordMenuOption
        || RecordCommandOption
           && !NoRecordMenuOption
        || RecordMenuOption) 
    {
      RecordFile_Open();
      RecordMenuOption = true;
    }
    else RecordFile_Close();
  };

  if (d.PartyHasDied == 0)
  {
    d.dungeonDatIndex = (DUNGEONDATINDEX *)allocateMemory(44,1);
  };
  D0W = FetchDataBytes((ui8 *)d.dungeonDatIndex, &CheckSum, 44);
  d.dungeonDatIndex->Swap();//swapDungeonDatIndex();
  if (D0W == 0) return 0;
  if (d.gameState != GAMESTATE_ResumeSavedGame)
  {
    //D6W = D0W = d.dungeonDatIndex->Word8();
    d.partyX = d.dungeonDatIndex->StartingPartyX();
    //D0W = sw(D6W >> 5);
    //D6W = D0W;
    d.partyY = d.dungeonDatIndex->StartingPartyY();
    d.partyFacing = d.dungeonDatIndex->StartingPartyFacing();
    d.partyLevel = 0;
  };
  numLevel = d.dungeonDatIndex->NumLevel();
  if (cellflagArraySize == 0)
  {
    cellflagArraySize = d.dungeonDatIndex->LegacyCellFlagArraySize();
  }
  else
  {
    d.dungeonDatIndex->LegacyCellFlagArraySize(0);
  };
  D0W = d.PartyHasDied;
  if (D0W == 0)
  {
    d.pLevelDescriptors =
           (LEVELDESC *)allocateMemory(16 * numLevel, 1);
  };
  D0W = FetchDataBytes((ui8 *)d.pLevelDescriptors,&CheckSum,
                        16 * numLevel);
  if (D0W == 0) return 0;
  // We promised to littleEndian words 0, 8, 10, 12, and 14 of
  // each of the 16-byte structures.
  swapLevelDescriptors(numLevel);
  D0W = d.PartyHasDied;
  if (D0W == 0)
  {
    d.objectLevelIndex = (ui16 *)allocateMemory(2*numLevel, 1);
  };
  D4W = 0;
  for (D5W=D4W; D5W<numLevel; D5W++)
  {
    d.objectLevelIndex[D5W] = D4W;
    D0W = d.pLevelDescriptors[D5W].LastColumn();
    D4W = sw(D4W + D0W + 1);

  };
  d.numColumnPointers = D4W;
  D5W = d.dungeonDatIndex->ObjectListLength();
  if (d.gameState != GAMESTATE_ResumeSavedGame)
  {
    d.dungeonDatIndex->ObjectListLength(uw(d.dungeonDatIndex->ObjectListLength() + 300));
  };
  if (d.PartyHasDied == 0)
  {
    objectListIndexSize = (D4W<<1)&0xffff;
    d.objectListIndex = (ui16 *)allocateMemory(objectListIndexSize,1);
    objectListSize = 2*d.dungeonDatIndex->ObjectListLength();
    d.objectList = (RN *)UI_malloc(objectListSize,MALLOC095);
    indirectTextIndexSize = (d.dungeonDatIndex->NumWordsInTextArray()<<2)&0xffff;
    d.indirectTextIndex = (ui32 *)UI_malloc(indirectTextIndexSize,
                                             MALLOC039);
    d.compressedText = NULL;
    d.sizeOfCompressedText = 0;
  }
  else
  {
    memSizeError = 0;
    if (objectListIndexSize < ((D4W<<1)&0xffff))
    {
      memSizeError |= 1;
    };
    if (objectListSize < 2*d.dungeonDatIndex->ObjectListLength())
    {
      memSizeError |= 2;
    };
    if (indirectTextIndexSize < ((d.dungeonDatIndex->NumWordsInTextArray()<<2) & 0xffff))
    {
      memSizeError |= 4;
    };
    if (memSizeError != 0)
    {
      UI_MessageBox("Something is very wrong.  The size\n"
                    "of some basic database has gotten\n"
                    "larger since we saved that game.\n"
                    "You can run it by exiting and 'Resuming'\n"
                    "from that savegame.",
                    "Error", MESSAGE_OK);
      die(0x445c);
    };
  };
  D0W = FetchDataBytes((ui8 *)d.objectListIndex,&CheckSum,(ui16)D4W*2);
  if (D0W == 0) return 0;
  swapPointer10454();
  D0W = FetchDataBytes((ui8 *)d.objectList,&CheckSum,D5W*2);
  if (D0W == 0) return 0;
  swapPRN10464(D5W);
  if (d.gameState != GAMESTATE_ResumeSavedGame)
  {
    for (D4W=0; D4W<300; D4W++)
    {
      d.objectList[D5W++] = RN(RNnul);

    };
  };
  

  if (!indirectText)
  { 
    textArray.p = (ui16 *)UI_malloc(d.dungeonDatIndex->NumWordsInTextArray()*2,
                                    MALLOC040);
    D0W = FetchDataBytes((ui8 *)textArray.p, &CheckSum, d.dungeonDatIndex->NumWordsInTextArray()*2);
    if (D0W == 0) return 0;
  }
  else //if m_indirectText
  {//nothing is swapped!
    //fetch indirecttext(NumWordsInTextArray);
    D0W = FetchDataBytes(
                  (ui8 *)d.indirectTextIndex, 
                  &CheckSum, 
                  d.dungeonDatIndex->NumWordsInTextArray()*4);
    SwapIndirectTextIndex();
    if (D0W == 0) return 0;
      //fetch sizeof compressedText;
    if (d.compressedText != NULL)
    {
      UI_free (d.compressedText);
      d.compressedText = NULL;
      d.sizeOfCompressedText = 0;
    };
    D0W = FetchDataBytes(
                  (ui8 *)&d.sizeOfCompressedText, 
                  &CheckSum, 
                  4);
    d.sizeOfCompressedText = BE32(d.sizeOfCompressedText);
    if (D0W == 0) return 0;
    //fetch compressedText;
    if (d.sizeOfCompressedText > 1000000)
    {
      die(0x4ccce,"Excessive compressed text");
    };
    d.compressedText = (ui16 *)UI_malloc(d.sizeOfCompressedText*2,
                                         MALLOC041);
    D0W = FetchDataBytes(
                  (ui8 *)d.compressedText, 
                  &CheckSum, 
                  d.sizeOfCompressedText*2);
    if (D0W == 0) return 0;
  };
  if (d.gameState != GAMESTATE_ResumeSavedGame) 
  {
    gameTimers.Allocate(100);
    gameTimers.InitializeTimers();
  };
  for (D6W=0; D6W<16; D6W++)
  {
    //D5W = D6W;

    D5W = d.dungeonDatIndex->DBSize(D6W);  // number of entries
    if (d.gameState != GAMESTATE_ResumeSavedGame)
    {
      D0W = D5W;
      A0 = d.Byte7302 + D6W;
      D3W = *((ui8 *)A0);
      D0W = sw(D0W + D3W);
      //D0W = sw(Smaller(D6W==15 ? 768 : 1024, D0W));
      d.dungeonDatIndex->DBSize(D6W, D0W);
    };
    if (D6W == dbSCROLL)
    {
      if (readScrollDatabase(&CheckSum) == 0) return 0;
      continue;
    };
    D4L = dbEntrySizes[D6W];
    if ( (D6W==dbACTUATOR) & !bigActuators)
    {
      D4W -= 2;
    };
    // Always allocate!!  If it is already allocated then
    // it will get released and reallocated to the
    // correct size!  This was a bad bug that made
    // some saved games unloadable.
    //if (d.Word22584 == 0)
    {
      //D0L = d.dungeonDatIndex[D6W+6] * D4W;
      //D0L &= 0xffff;
      //if (D0L != 0) A0 = allocateMemory(D0L,1);
      //else A0 = NULL;
      //d.misc1052eight[D6W] = (UNKNOWN *)A0;
      db.Allocate(D6W, d.dungeonDatIndex->DBSize(D6W));

      // if (d.dungeonDatIndex[D6W+6] != 0)
      // {
      //   d.misc10528[D6W] = db.GetCommonAddress(RN(0,D6W,0));
      // }
      // else
      // {
      //   d.misc10528[D6W] = NULL;
      // };
    };
    if (d.dungeonDatIndex->DBSize(D6W) != 0)
    {
      DBA3 = db.GetCommonAddress(DBTYPE(D6W),0);
      D0W = FetchDataBytes((ui8 *)DBA3, &CheckSum, (ui16)D4W * (ui16)D5W);
      if (D0W == 0) return 0;
      if ( (D6W==dbACTUATOR) && !bigActuators)
      {
        MakeBigActuators();
      }
      db.swap(D6W);// database
    };
    if (d.gameState != GAMESTATE_ResumeSavedGame)
    {
      if ((D6W == dbMONSTER) || (D6W >= dbMISSILE))
      {
        D0W = d.dungeonDatIndex->DBSize(D6W);
        gameTimers.Allocate(sw(gameTimers.MaxTimer() + D0W));
      };
      
      // All the enclosed code is to clear the extra
      // entries that we allocated but did not initialize
      // by reading from the file.
      // But the new db.Allocate clears all the entries.
      // Therefore, this code is not needed.  And that is
      // nice because it is quite ugly.
      // D1W = D4W >> 1;
      // D4W = D1W;
      // LOCAL_30 = D1W;
      // D1L = D5UW * (ui16)LOCAL_30;
      // //D1 <<= 1;
      // pwA3 += D1L;
      // D5W = (UI8)(d.Byte7302[D6W]); //# additional entries
      // while (D5W != 0)
      // {
      //   pwA3[0] = -1;
      //   //      D0W = D5W;
      //   D5W--;
      //   D1W = D4W;
      //   D1H1 = 0;
      //   //D1 <<= 1;
      //   pwA3 += D1L;
      // };
    };

  }; //for
  if (!indirectText)
  {
    if (ConvertToIndirectText(textArray.p) == 0) return 0;
  };
  if (d.PartyHasDied == 0)
  {
    d.cellFlagArray = (CELLFLAG *)allocateMemory(cellflagArraySize,1);
  };
  D0W = FetchDataBytes((ui8 *)d.cellFlagArray,&CheckSum,cellflagArraySize);
  if (D0W == 0) return 0;
  D0W = StreamInput((ui8 *)&LOCAL_6, 2); // Read without updating checksum
  LOCAL_6 = LE16(LOCAL_6);
  if ((D0W!=0) && (LOCAL_6!=CheckSum)) return 0;
  if (d.PartyHasDied == 0)
  {
    D0L = 4 *(d.numColumnPointers + numLevel);
    // D7W is number of index pointers at the
    //  front of d.10450.
    d.pppdPointer10450 = (CELLFLAG ***)allocateMemory(D0L, 1);
    ppdA2 = (CELLFLAG **)&d.pppdPointer10450[numLevel];
      // Need cast because the 10450 array is used for
      // two things.  See comments in data definitions.
    for (i32 level=0; level < numLevel; level++)
    {
      d.pppdPointer10450[level] = ppdA2;
      //pntGear(A0) = A2;
      pdD0 = d.cellFlagArray;
      //pA0 = &d.pLevelDescriptors[level];
      //D3L = pA0->cellOffset;
      //D3H1 = 0;
      if (level == 0)
      {
        celloffset = d.pLevelDescriptors[0].cellOffset;
      }
      else
      {
        celloffset += (d.pLevelDescriptors[level].cellOffset
                      - d.pLevelDescriptors[level-1].cellOffset)
                      & 0xffff;
      };
      pdD0 = pdD0 + celloffset; // Add Byte offset
      //pdD0 = (CELLFLAG *)((i32)pdD0 + D3L); // Add Byte offset
      LOCAL_4 = pdD0;
      *ppdA2 = pdD0;
      ppdA2++;
      for (i32 column=1;
           column<= BITS6_10(d.pLevelDescriptors[level].word8);
           column++)
      {
        pA0 = &d.pLevelDescriptors[level];
        D1W = (I16)((pA0->word8 >> 11) & 0x1f);
        D1W++;
        pdD0 = LOCAL_4;
        D1L &= 0xffff;
        pdD0 = pdD0 + D1L; //add byte offset
        //pdD0 = (DUDAD16 *)((i32)pdD0+D1L); //add byte offset
        LOCAL_4 = pdD0;
        *ppdA2 = pdD0;
        ppdA2++;
      }; // for column
    };/// for level
  };
  if (d.inStreamBuffered != 0)
  {
    d.inStreamBuffered = 0;
    TAG021800(LE32(LoadLong(LOCAL_20+2)));
  };

  if (ExtendedFeaturesVersion == '@')
  {
    // ****************************************************
    //
    // We need to expand the database to the 'linear'
    // model.
    // We need to search the dungeon and convert all
    // objects of class RN to the new model.
    // Should be fun.
    i32 level, x, y;
    CELLFLAG cf, *columnPointerCF;
    RN *columnPointerRN;
    for (level=0; level<d.dungeonDatIndex->NumLevel(); level++) {
      for (x=0; x<=d.pLevelDescriptors[level].LastColumn(); x++) {
        columnPointerCF = d.pppdPointer10450[level][x];
        columnPointerRN = d.objectList + d.objectListIndex[d.objectLevelIndex[level]+x];
        for (y=0; y<=d.pLevelDescriptors[level].LastRow(); y++) {
          cf = d.pppdPointer10450[level][x][y];
          if ((cf & 0x10) == 0)
            continue;
          ConvertListOfObjects(columnPointerRN, false, level, x + d.pLevelDescriptors[level].offsetX, y + d.pLevelDescriptors[level].offsetY);
            //And sub-lists, too. Chest/Monster/scroll/missile
          columnPointerRN++;
        }
      }
    }
    if (gameTimers.pTimer(0) != NULL)
      ConvertTimers();
    ConvertCharacters();
  };
  if (RememberToPutObjectInHand != -1)
  {
    die(0x40e);
  };
  if ((ExtendedFeaturesVersion == '@') &&(d.objectInHand != RNnul) )
  {
    //CURSORFILTER_PACKET cfp;
    //cfp.type = CURSORFILTER_Unknown;
    //cfp.object = d.objectInHand.ConvertToInteger();
    //CursorFilter(&cfp);
   
    ConvertListOfObjects(&d.objectInHand, false, 0, -5, 0);
  };
  if (ExtendedFeaturesVersion == '@') {
    ExtendedFeaturesVersion = 'A';
  }

  RememberToPutObjectInHand = -1;
  if (ExtendedFeaturesVersion < 'B') {
    convertScrolls();
    ExtendedFeaturesVersion = 'B';
  }
  expool.Setup();
  return 1;
}

void ExpandData(pnt src,pnt dst,i32 dstSize) //TAG0206f8
{
  // Data file consists of variable length fields.
  // There are 20 bytes at the beginning that are
  // lookup tables---the first is 4 bytes long
  // and is used to decode data of the form
  // ( in binary ) of 0xx.  xx is the index into the
  // table.
  // The next table is 16 bytes long and is used to
  // decode data of the form 10yyyy where yyyy is used
  // as an index into the table.
  // The only remaining case is data of the form
  // 11zzzzzzzz where zzzzzzzz is a literal byte.
  // Summary:
  // 0xx        index into small table
  // 10yyyy     index into large table
  // 11zzzzzzzz literal data
//;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
  dReg D0, D1, D7;
  aReg A0, A2, A3;
  //SaveRegs(0x0130);
  A3 = src;
  A2 = dst;
  D7L = dstSize;
  A0 = A3;
  A3 = A3 + 20;
  D1H1 = 0;
tag020714: // Start new 16-bit input word.
  D1W = LE16(wordGear(A3));
  A3 += 2;
  D0L = 16; // # bits in D1W;
tag020718: // Is next bit a '1'?
  if ((D1W & 0x8000) == 0) goto tag02073c;
  getBits(2, D0, D1, A3);
  SWAP(D1);
  D1W -= 2;
  if (D1W != 0) goto tag020732;
  SWAP(D1);
  getBits(4, D0, D1, A3);
  SWAP(D1);
  *A2 = *(A0 + D1W + 4);
  A2++;
  goto tag020744;
tag020732:
  SWAP(D1);//D1L = D1UH[1] | (D1UH[0] << 16);
  getBits(8, D0, D1, A3);
  SWAP(D1);//D1L = D1UH[1] | (D1UH[0] << 16);
  *A2 = D1B;
  A2++;
  goto tag020744;
tag02073c:
  getBits(3, D0, D1, A3);
  SWAP(D1);//D1L = D1UH[1] | (D1UH[0] << 16);
  *A2 = *(A0 + D1W);
  A2++;
tag020744:
  D7W--;
  if (D7W == 0) goto tag020766;
  D1H2 = D1H1;
  D1H1 = 0;
  if (D0W != 0) goto tag020718;
  goto tag020714;
tag020766:
  //RestoreRegs(0x0c80);
  return;
}

// *********************************************************
//
// *********************************************************
void ConvertListOfObjects(RN *pRN, bool DuplicateOK, i32 level, i32 x, i32 y) {
  i32 dbNum, pos, idx;
  i32 i, newDML, duplicate;
  DBCOMMON *pDB;
  while (*pRN != RNeof) {
    if ((*pRN == RNnul) || pRN->IsMagicSpell()) {
      UI_MessageBox("Illegal object", "Sorry", MB_OK);
      die(0xeed18);
    }
    dbNum = (pRN->ConvertToInteger() >> 10) & 15;
    pos   = (pRN->ConvertToInteger() >> 14) & 3;
    idx   = pRN->ConvertToInteger() & 0x3ff;
    if (idx >= db.NumEntry(dbNum)) {
      char msg[80];
      sprintf(msg,"Illegal object at %d(%02d,%02d)", level, x, y);
      UI_MessageBox(msg,"Sorry",MB_OK);
      *pRN = RNeof;
      return;
    }
    pDB = db.GetCommonAddress(DBTYPE(dbNum), idx);
    duplicate = -1;
    for (i=1; i<dataMapLength; i++)
    { //Search to see if it is already present
      if ((dataTypeMap[i] & 15) != dbNum) continue;
      if (dataIndexMap[i] != idx) continue;
      if (DuplicateOK) {
        duplicate = i;
        break;
      } else {
        UI_MessageBox("Duplicated Object", "Sorry", MB_OK);
        die (0xccdde);
      }
    }
    if (duplicate >= 0) {
      pRN->ConstructFromInteger(duplicate);
    } else {
      newDML = 32*(dataMapLength/32) + 33;
      dataTypeMap = (ui8 *)UI_realloc(dataTypeMap, newDML, MALLOC051);
      dataIndexMap = (ui16 *)UI_realloc(dataIndexMap, 2* newDML, MALLOC052);
      if (dataMapLength == 0) {
        // Don't use entry zero.
        dataTypeMap[0] = 0;
        dataIndexMap[0] = 0;
        dataMapLength = 1;
      };
      dataTypeMap[dataMapLength] = (ui8)((pos<<4) | dbNum);
      dataIndexMap[dataMapLength] = (ui16)idx;
      dataMapLength++;
      pRN->ConstructFromInteger(dataMapLength-1);
    }
    if (duplicate == -1) {//Don't convert objects twice.
      switch (dbNum) {
      case dbCHEST:
        DB9 *pChest;
        pChest = pDB->CastToDB9();
        if (pChest->contents() != RNeof)
          ConvertListOfObjects(pChest->pContents(), false, level,x,y);
        break;
      case dbMONSTER:
        DB4 *pMonster;
        pMonster = pDB->CastToDB4();
        if (pMonster->possession() != RNeof)
          ConvertListOfObjects(pMonster->pPossession(), false, level,x,y);
        break;
      case dbMISSILE:
        DB14 *pMissile;
        pMissile = pDB->CastToDB14();
        if ((pMissile->flyingObject() != RNeof) && !pMissile->flyingObject().IsMagicSpell())
          ConvertListOfObjects(pMissile->pFlyingObject(), true, level,x,y);
        break;
      case dbSCROLL:
        //Nothing to do.  It has index of Text Entry.
        break;
      }
    }
    pRN = &(pDB->m_link);
  }
}

void ConvertTimers() {
  TIMER_SEARCH timerSearch;
  //for (i32 i=0; i<d.MaxTimer(); i++)
  while (timerSearch.FindNextTimer()) {
    TIMER *pTimer;
    pTimer = timerSearch.TimerAddr();
    switch (pTimer->Function()) {
      case 24:
      case 25: ConvertListOfObjects(pTimer->pTimerObj8(), false, 0,-1,0);
               break;
      case 48:
      case 49: ConvertListOfObjects(pTimer->pTimerObj6(), true, 0,-2,0); // The flying object
               break;
      case 60:
      case 61: ConvertListOfObjects(pTimer->pTimerObj8(), false, 0,-3,0);
               break;
    }
  }
}

void ConvertCharacters() {
  i32 i, j;
  for (i=0; i<d.NumCharacter; i++)
    for (j=0; j<30; j++)
      if (d.CH16482[i].Possession(j) != RNnul) {
        RN temp = d.CH16482[i].Possession(j);
        ConvertListOfObjects(&temp, false, 0,-4,0);
        d.CH16482[i].SetPossession(j, temp, true);
      }
}
*/
